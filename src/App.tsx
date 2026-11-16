import { useEffect, useState } from 'react';
import { createIdentity, generateData, presets, type Identity, type Locale } from './engine';
import { hostPattern, mappingTypes, runOnPage, type Field, type PageIssue } from './fill';
import { saveMapping } from './mappings';
import { MailboxPanel } from './MailboxPanel';
import { mailId } from './mail-display';
import { Icon } from './Icon';
import './style.css';

const isExtension = !!globalThis.chrome?.storage?.local;
async function readSaved(): Promise<Identity | undefined> {
  if (isExtension) return (await chrome.storage.local.get('identity')).identity as Identity | undefined;
  const raw = localStorage.getItem('identity'); return raw ? JSON.parse(raw) : undefined;
}
async function saveIdentity(identity: Identity) {
  if (isExtension) {
    const { identityHistory = [] } = await chrome.storage.local.get('identityHistory');
    const history = (identityHistory as Identity[]).filter(p => p.id !== identity.id);
    if (identity.mailbox.status !== 'test') history.unshift(identity);
    await chrome.storage.local.set({ identity, identityHistory: history.slice(0, 30) });
  }
  else localStorage.setItem('identity', JSON.stringify(identity));
}
async function readPreferences(): Promise<{ locale?: Locale; emptyOnly?: boolean }> {
  try { return isExtension ? (await chrome.storage.local.get('preferences')).preferences as { locale?: Locale; emptyOnly?: boolean } || {} : JSON.parse(localStorage.getItem('preferences') || '{}'); }
  catch { return {}; }
}
export function App() {
  const [tab, setTab] = useState<'identity' | 'inbox' | 'json' | 'settings'>('identity');
  const [identity, setIdentity] = useState<Identity>();
  const [locale, setLocale] = useState<Locale>('en_NG');
  const [notice, setNotice] = useState('');
  const [empty, setEmpty] = useState(true);
  const [fields, setFields] = useState<Field[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [target, setTarget] = useState<number>();
  const [undoTab, setUndoTab] = useState<number>();
  const [targetDocument, setTargetDocument] = useState<string>();
  const [undoDocument, setUndoDocument] = useState<string>();
  const [undoUrl, setUndoUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [siteUrl, setSiteUrl] = useState('');
  const [scannedUrl, setScannedUrl] = useState('');
  const [issues, setIssues] = useState<PageIssue[]>([]);
  const [blueprint, setBlueprint] = useState(JSON.stringify(presets.Users, null, 2));
  const [count, setCount] = useState(10);
  const [seed, setSeed] = useState(42);
  const [output, setOutput] = useState('');
  const [blueprintName, setBlueprintName] = useState('Users');
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Identity[]>([]);
  useEffect(() => {
    readSaved().then(async p => { const preferences = await readPreferences(); const preferredLocale = preferences.locale === 'en_US' ? 'en_US' : preferences.locale === 'en_NG' ? 'en_NG' : undefined; const next = p?.mailbox && ['test', 'active', 'expired'].includes(p.mailbox.status) && p.firstName && p.email ? p : createIdentity(preferredLocale || 'en_NG'); setIdentity(next); setLocale(preferredLocale || next.locale); setEmpty(preferences.emptyOnly !== false); return saveIdentity(next); }).catch(() => { setIdentity(createIdentity('en_NG')); setNotice('Storage unavailable. Your identity may not persist.'); });
    const load = async () => isExtension ? (await chrome.storage.local.get('blueprints')).blueprints : JSON.parse(localStorage.getItem('blueprints') || '{}');
    load().then(v => setSaved(v || {})).catch(() => setNotice('Saved blueprints could not be loaded.'));
    if (isExtension) chrome.storage.local.get('identityHistory').then(v => setHistory((v.identityHistory as Identity[]) || [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (!isExtension) return;
    let activeId: number | undefined;
    const refresh = () => { chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => { activeId = tab?.id; setSiteUrl(tab?.url || ''); invalidate(); setIssues([]); }).catch(() => setSiteUrl('')); };
    const updated = (tabId: number, changes: chrome.tabs.OnUpdatedInfo) => { if (tabId === activeId && (changes.url || changes.status === 'complete')) refresh(); };
    refresh(); chrome.tabs.onActivated.addListener(refresh); chrome.tabs.onUpdated.addListener(updated);
    return () => { chrome.tabs.onActivated.removeListener(refresh); chrome.tabs.onUpdated.removeListener(updated); };
  }, []);
  function invalidate() { setFields([]); setSelected([]); setTarget(undefined); setTargetDocument(undefined); }
  async function updatePreferences(nextLocale: Locale, emptyOnly: boolean) {
    setLocale(nextLocale); setEmpty(emptyOnly); setOutput(''); invalidate();
    const preferences = { locale: nextLocale, emptyOnly };
    try { if (isExtension) await chrome.storage.local.set({ preferences }); else localStorage.setItem('preferences', JSON.stringify(preferences)); }
    catch { setNotice('Could not save your preferences.'); }
  }
  async function regenerate() {
    const next = createIdentity(locale); setIdentity(next); invalidate();
    try { await saveIdentity(next); setNotice('New identity ready.'); } catch { setNotice('Identity created, but could not be saved.'); }
  }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setNotice('Copied to clipboard.'); } catch { setNotice('Clipboard unavailable. Select and copy the text manually.'); } }
  async function page(action: 'scan' | 'fill' | 'undo', profile = identity, requestAccess = true) {
    if (!profile) return;
    setBusy(true);
    try {
      // Ask directly inside the button gesture; no preceding asynchronous work.
      if (action === 'scan' && siteUrl && isExtension && requestAccess) {
        const granted = await chrome.permissions.request({ origins: [hostPattern(siteUrl)] });
        if (!granted) throw new Error('Page access was declined. Preview again and allow access to this site.');
      }
      const result = await runOnPage(action, profile, empty, selected, action === 'scan' ? undefined : action === 'undo' ? undoTab : target, Object.fromEntries(fields.map(f => [f.id, f.value])), action === 'scan' ? undefined : action === 'undo' ? undoDocument : targetDocument, action === 'scan' ? undefined : action === 'undo' ? undoUrl : scannedUrl);
      if (action === 'scan') setTargetDocument(result.documentId);
      if (action === 'fill') { setUndoDocument(result.documentId); setUndoUrl(result.pageUrl); }
      setIssues(result.issues); setScannedUrl(result.pageUrl);
      if (action === 'scan') { setFields(result.fields); setSelected(result.fields.filter(f => f.suggested).map(f => f.id)); setTarget(result.tabId); setNotice(result.count ? `Detected ${result.count} fields on this page. Review suggestions below; uncertain matches are unchecked.` : 'No supported fields found. Existing values may have been skipped.'); }
      else { if (action === 'fill') setUndoTab(result.changedCount ? result.tabId : undefined); else if (action === 'undo') setUndoTab(undefined); invalidate(); setNotice(`${result.count} field${result.count === 1 ? '' : 's'} ${action === 'fill' ? 'accepted their values' : 'restored'}.${result.skipped ? ` ${result.skipped} fields need attention; see the report.` : ''}`); }
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Unable to access this page.'); }
    finally { setBusy(false); }
  }
  async function rememberField(field: Field, type: string) {
    if (!field.key || !scannedUrl || !isExtension) return;
    setBusy(true);
    try { await saveMapping(scannedUrl, field.key, type); await page('scan', identity, false); }
    catch { setNotice('Could not save this field mapping. Please try again.'); }
    finally { setBusy(false); }
  }
  async function generateForPage() {
    const next = createIdentity(locale); setIdentity(next); invalidate();
    // Start page access in this click's gesture, before awaiting storage.
    const scanning = page('scan', next);
    try { await saveIdentity(next); } catch { setNotice('Could not save the new identity.'); }
    await scanning;
  }
  function generate() {
    setBusy(true); setOutput('');
    // Yield so the generating state can paint before processing a bounded dataset.
    setTimeout(() => {
      try { if (blueprint.length > 100000) throw new Error('Blueprint must be under 100 KB.'); setOutput(JSON.stringify(generateData(JSON.parse(blueprint), count, seed, locale), null, 2)); setNotice(`Generated ${count} records with seed ${seed}.`); }
      catch (e) { setNotice(e instanceof Error ? e.message : 'Invalid blueprint.'); }
      finally { setBusy(false); }
    }, 20);
  }
  async function saveBlueprint() {
    try {
      JSON.parse(blueprint);
      const name = blueprintName.trim(); if (!name || name.length > 60) throw new Error('Use a blueprint name between 1 and 60 characters.');
      const next = { ...saved, [name]: blueprint };
      if (isExtension) await chrome.storage.local.set({ blueprints: next }); else localStorage.setItem('blueprints', JSON.stringify(next));
      setSaved(next); setNotice('Blueprint saved locally.');
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Could not save blueprint.'); }
  }
  function download() { const url = URL.createObjectURL(new Blob([output], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'ea-rapidmock.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function selectIdentity(id: string) {
    const profile = history.find(p => p.id === id);
    if (profile) { setIdentity(profile); setLocale(profile.locale); invalidate(); void saveIdentity(profile).catch(() => setNotice('Could not save the selected identity.')); }
  }
  async function updateMailbox(next: Identity) {
    await saveIdentity(next); setIdentity(next); invalidate();
    if (isExtension) { const result = await chrome.storage.local.get('identityHistory'); setHistory((result.identityHistory as Identity[]) || []); }
  }
  const screens = {
    identity: { title: 'Ready for your next test.', description: 'Create a profile. Preview the page. Fill with confidence.' },
    inbox: { title: 'Verification, right here.', description: 'Your test emails. One focused inbox.' },
    json: { title: 'Good data. On demand.', description: 'A small blueprint. A whole dataset of possibilities.' },
    settings: { title: 'Make it yours.', description: 'Your defaults, mailbox access, and workspace preferences.' },
  };
  return <main>
    <div className="app-chrome"><header><div className="logo">ea<span>↗</span></div><div><h1>RapidMock</h1><p>A better kind of test run.</p></div><span className="local"><i/> LOCAL FIRST</span></header>
    <nav aria-label="Tools">{(['identity', 'inbox', 'json', 'settings'] as const).map(view => <button key={view} aria-current={tab === view ? 'page' : undefined} className={tab === view ? 'active' : ''} onClick={() => setTab(view)}><Icon name={view}/><span>{view === 'json' ? 'JSON' : view[0].toUpperCase() + view.slice(1)}</span>{view === 'inbox' && identity?.mailbox.status === 'active' && <i className="nav-dot"/>}</button>)}</nav></div>
    <section className="screen-heading"><span className="eyebrow">YOUR WORKSPACE / {tab.toUpperCase()}</span><h2>{screens[tab].title}</h2><p>{screens[tab].description}</p></section>
    {tab === 'identity' && <>
      {identity && <section className="card identity"><div className="cardhead"><span className="eyebrow">ACTIVE IDENTITY</span><span className="badge">{identity.mailbox.status === 'test' ? 'Test email' : identity.mailbox.status === 'active' && Date.parse(identity.mailbox.expiresAt) > Date.now() ? 'Receiving email' : 'Expired inbox'}</span></div><div className="person"><div className="avatar">{identity.firstName[0]}{identity.lastName[0]}</div><div><h3>{identity.firstName} {identity.lastName}</h3><p>{identity.company}</p></div></div>
        <div className="email"><div><span className="eyebrow">MAIL ID</span><div className="break">{mailId(identity.email)}</div></div><button className="icon" aria-label="Copy full email address" onClick={() => copy(identity.email)}><Icon name="copy"/></button></div>
        <details className="profile-details"><summary>Identity details</summary><dl><div><dt>USERNAME</dt><dd>{identity.username}</dd></div><div><dt>PHONE · SIMULATED</dt><dd>{identity.phone}</dd></div><div className="wide"><dt>ADDRESS · SYNTHETIC</dt><dd>{identity.street}<br/>{identity.city}, {identity.state} {identity.postalCode}<br/>{identity.country}</dd></div></dl></details>
        <div className="row"><button disabled={busy} onClick={regenerate}><Icon name="refresh" size={15}/>New identity</button><button onClick={() => copy(JSON.stringify(identity, null, 2))}><Icon name="copy" size={15}/>Copy JSON</button></div>
        <div className="profile-meta"><span><Icon name="globe" size={13}/>{identity.locale === 'en_NG' ? 'Nigeria' : 'United States'}</span><button className="text-button" onClick={() => setTab('inbox')}>{identity.mailbox.status === 'active' ? 'Open inbox' : 'Add optional inbox'}<Icon name="arrow" size={13}/></button></div>
        {identity.locale !== locale && <p className="hint">Create a new identity to apply the selected locale.</p>}
      </section>}
      <section className="card fill-card"><div className="cardhead"><div className="section-title"><span className="section-icon"><Icon name="arrow"/></span><h3>Fill the page</h3></div><span className="badge muted">REVIEW FIRST</span></div><div className="site-context"><Icon name="globe" size={14}/><span>{siteUrl ? (() => { try { return new URL(siteUrl).hostname || 'Current page'; } catch { return 'Current page'; } })() : 'Open a webpage to get started'}</span></div><p className="sub">Match this profile to the page’s fields, then review before filling.</p><label className="check"><input type="checkbox" checked={empty} onChange={e => void updatePreferences(locale, e.target.checked)}/> Fill empty fields only</label><button className="primary full" disabled={busy || !identity} onClick={() => page('scan')}><Icon name="arrow" size={16}/>{busy ? 'Reading the page…' : 'Preview matching fields'}</button><div className="row secondary-actions"><button disabled={busy || !identity} onClick={generateForPage}>Generate fresh profile & preview</button><button disabled={busy || undoTab === undefined} onClick={() => page('undo')}>Undo fill</button></div>
      {!!fields.length && <div className="preview"><div className="preview-header"><h3>Review fields</h3><span className="badge">{selected.length} / {fields.length} selected</span></div>{fields.map(f => <div className="field" key={f.id}>
        <input aria-label={`Select ${f.label}`} type="checkbox" checked={selected.includes(f.id)} onChange={e => setSelected(e.target.checked ? [...selected, f.id] : selected.filter(id => id !== f.id))}/>
        <div className="field-editor"><label htmlFor={`field-${f.id}`}>{f.label} <small>· {f.kind}</small></label>
          {f.options ? <select id={`field-${f.id}`} value={f.value} onChange={e => setFields(fields.map(item => item.id === f.id ? { ...item, value: e.target.value } : item))}>{f.options.map((o, i) => <option key={i} value={o.value}>{o.label}</option>)}</select> : <input id={`field-${f.id}`} type={f.kind === 'test password' ? 'password' : 'text'} autoComplete="off" value={f.kind === 'email' ? mailId(f.value) : f.value} onChange={e => setFields(fields.map(item => item.id === f.id ? { ...item, value: f.kind === 'email' ? `${mailId(e.target.value)}@${f.value.split('@')[1] || identity?.email.split('@')[1] || 'example.com'}` : e.target.value } : item))}/>}
          {f.warning && <p className="hint">{f.warning}</p>}
          {isExtension && f.key && f.kind !== 'test password' && <details className="mapping"><summary>Field mapping{f.mapping ? ` · ${f.mapping}` : ''}</summary><label>Remember this field as<select aria-label={`Mapping for ${f.label}`} value={f.mapping || ''} disabled={busy} onChange={e => rememberField(f, e.target.value)}><option value="">Auto-detect</option>{mappingTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label></details>}
        </div></div>)}<button className="primary full" disabled={!selected.length || busy} onClick={() => page('fill')}>Fill {selected.length} selected fields</button></div>}</section>
      {!!issues.length && <details className="card issue-report"><summary>{issues.length} field{issues.length === 1 ? '' : 's'} needing attention</summary><ul className="issue-list">{issues.map((issue, i) => <li key={i}><strong>{issue.label}</strong><span>{issue.reason}</span></li>)}</ul></details>}
      <p className="footnote"><Icon name="shield" size={13}/>You review. You fill. Forms never submit automatically.</p>
    </>}
    {tab === 'settings' && <section className="card"><div className="cardhead"><h3>Workspace preferences</h3><span className="badge muted">ON THIS DEVICE</span></div><label className="preference-row"><span><strong>Profile locale</strong><small>Used for new identities and generated data.</small></span><select aria-label="Data locale" value={locale} onChange={e => void updatePreferences(e.target.value as Locale, empty)}><option value="en_NG">Nigeria · EN</option><option value="en_US">United States · EN</option></select></label><label className="preference-row"><span><strong>Keep existing values</strong><small>Skip filled fields when previewing a form.</small></span><input type="checkbox" checked={empty} onChange={e => void updatePreferences(locale, e.target.checked)}/></label></section>}
    <div hidden={tab !== 'inbox' && tab !== 'settings'}>
      {tab === 'inbox' && identity && <section className="card inbox-profile"><div className="cardhead"><span className="eyebrow">CURRENT MAIL ID</span><span className="badge muted">{identity.firstName} {identity.lastName}</span></div><div className="mail-id-row"><strong>{mailId(identity.email)}</strong><button className="icon" aria-label="Copy full email address" onClick={() => copy(identity.email)}><Icon name="copy"/></button></div>{!!history.length && <details><summary>Switch saved inbox</summary><select className="full" aria-label="Saved mailbox identities" disabled={busy} value="" onChange={e => selectIdentity(e.target.value)}><option value="">Choose an identity…</option>{history.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} — {mailId(p.email)}</option>)}</select></details>}</section>}
      {identity && <MailboxPanel identity={identity} visible={tab === 'inbox' || tab === 'settings'} view={tab === 'settings' ? 'settings' : 'inbox'} onViewChange={setTab} onBusy={setBusy} notify={setNotice} onChange={updateMailbox}/>}
    </div>
    {tab === 'settings' && <section className="card privacy-card"><span className="section-icon"><Icon name="shield"/></span><div><h3>Local by default.</h3><p>Identity generation, form matching, and JSON stay on your device. Optional inboxes use your connected email service.</p><span className="eyebrow">EA RAPIDMOCK · v0.6.0</span></div></section>}
    {tab === 'json' && <>
      <section className="card"><div className="cardhead"><h3>Your blueprint</h3><span className="badge muted">JSON</span></div><div className="presets">{Object.entries(presets).map(([name, value]) => <button key={name} className={blueprintName === name ? 'selected' : ''} onClick={() => { setBlueprint(JSON.stringify(value, null, 2)); setBlueprintName(name); setOutput(''); }}>{name}</button>)}</div><textarea aria-label="JSON blueprint" spellCheck={false} value={blueprint} onChange={e => { setBlueprint(e.target.value); setOutput(''); }}/><details><summary>Available tokens & syntax</summary><p className="hint">Wrap tokens in double braces. Literal arrays stay arrays. Use { '{"$pick": ["a", "b"]}' } for a random choice.</p><code>string.uuid · person.firstName · person.lastName · person.fullName · internet.email · internet.username · company.name · commerce.productName · commerce.price · commerce.department · date.past · number.int · datatype.boolean</code></details><div className="settings"><label>Records<input type="number" min="1" max="5000" value={count} onChange={e => { setCount(Number(e.target.value)); setOutput(''); }}/></label><label>Seed<input type="number" min="0" max="4294967295" value={seed} onChange={e => { setSeed(Number(e.target.value)); setOutput(''); }}/></label></div><button className="primary full" disabled={busy} onClick={generate}>{busy ? 'Generating…' : 'Generate dataset'}</button></section>
      <section className="card"><h3>Save this blueprint</h3><div className="row"><input aria-label="Blueprint name" value={blueprintName} onChange={e => setBlueprintName(e.target.value)}/><button onClick={saveBlueprint}>Save</button></div>{!!Object.keys(saved).length && <select className="full" aria-label="Load saved blueprint" defaultValue="" onChange={e => { if (e.target.value) { setBlueprint(saved[e.target.value]); setBlueprintName(e.target.value); setOutput(''); } e.target.value = ''; }}><option value="">Load a saved blueprint…</option>{Object.keys(saved).map(n => <option key={n}>{n}</option>)}</select>}</section>
      {output && <section className="card"><div className="cardhead"><h3>Dataset preview</h3><span className="badge">{count} records</span></div><pre>{output.length > 20000 ? output.slice(0, 20000) + '\n… Preview truncated. Copy or download the complete dataset.' : output}</pre><div className="row"><button onClick={() => copy(output)}>Copy JSON</button><button className="primary" onClick={download}>Download .json</button></div></section>}
      <p className="footnote">Same blueprint + locale + seed = the same dataset.</p>
    </>}
    {notice && <div className="notice" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
    <footer><span>EA RAPIDMOCK</span><span>Built for your next build.</span></footer>
  </main>;
}
