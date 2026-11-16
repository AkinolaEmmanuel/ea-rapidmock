import { useEffect, useRef, useState } from 'react';
import type { Identity } from './engine';
import { mailId } from './mail-display';
import { DEFAULT_MAIL_SERVICE, MailApiError, mailboxCommand, serviceUrl, verificationCodes, type MailboxInfo, type MailMessage } from './mail-api';

export function MailboxPanel({ identity, onChange, onBusy, notify, view, visible = true, onViewChange }: { identity: Identity; onChange: (identity: Identity) => Promise<void>; onBusy: (busy: boolean) => void; notify: (text: string) => void; view?: 'inbox' | 'settings'; visible?: boolean; onViewChange?: (view: 'inbox' | 'settings') => void }) {
  const [connected, setConnected] = useState(false), [endpoint, setEndpoint] = useState(DEFAULT_MAIL_SERVICE), [code, setCode] = useState('');
  const [busy, setBusy] = useState(false), [settingsState, setSettingsState] = useState(false);
  const settings = view ? view === 'settings' : settingsState;
  function setSettings(next: boolean) { setSettingsState(next); onViewChange?.(next ? 'settings' : 'inbox'); }
  const [confirmation, setConfirmation] = useState<'clear' | 'mailbox' | 'rotate' | 'message'>();
  const [clock, setClock] = useState(Date.now()), [refreshing, setRefreshing] = useState(false);
  const [messages, setMessages] = useState<MailMessage[]>([]), [opened, setOpened] = useState<MailMessage>();
  const [error, setError] = useState(''), [lastRefresh, setLastRefresh] = useState('');
  const current = useRef(identity); current.current = identity;
  const loading = useRef(false);
  const operation = useRef(false);
  const refreshVersion = useRef(0);
  const box = identity.mailbox.status === 'test' ? undefined : identity.mailbox;
  const active = box?.status === 'active';
  const remaining = box ? Math.max(0, Date.parse(box.expiresAt) - clock) : 0;
  const expired = box?.status === 'expired' || (!!box && remaining <= 0);
  const timeLeft = `${Math.floor(remaining / 60000)}:${String(Math.floor(remaining / 1000) % 60).padStart(2, '0')}`;
  useEffect(() => { mailboxCommand<{ connected: boolean; baseUrl: string }>({ action: 'status' }).then(s => { setConnected(s.connected); setEndpoint(s.baseUrl || DEFAULT_MAIL_SERVICE); }).catch(e => { setConnected(false); setError(e instanceof Error ? e.message : 'Could not load mailbox access.'); }); }, []);
  useEffect(() => { setMessages([]); setOpened(undefined); setError(''); setLastRefresh(''); setConfirmation(undefined); setClock(Date.now()); }, [identity.id, identity.email]);
  useEffect(() => { setClock(Date.now()); if (!active || !visible || settings) return; const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, [active, visible, settings]);
  async function perform(task: () => Promise<void>) {
    operation.current = true; refreshVersion.current++; setBusy(true); onBusy(true); setError('');
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : 'Mailbox request failed.'); }
    finally { operation.current = false; setBusy(false); onBusy(false); }
  }
  async function refresh(profile = identity) {
    if (loading.current || operation.current || profile.mailbox.status !== 'active' || document.hidden || !visible || settings) return;
    loading.current = true; setRefreshing(true); const version = refreshVersion.current;
    try {
      const result = await mailboxCommand<{ messages: MailMessage[] }>({ action: 'messages', mailboxId: profile.mailbox.id });
      if (version === refreshVersion.current && !operation.current && current.current.id === profile.id && current.current.email === profile.email) { setMessages(result.messages); setLastRefresh(new Date().toLocaleTimeString()); setError(''); }
    } catch (e) {
      if (version !== refreshVersion.current || operation.current || current.current.id !== profile.id || current.current.email !== profile.email) return;
      if (e instanceof MailApiError && e.status === 404) await onChange({ ...profile, mailbox: { ...profile.mailbox, status: 'expired' } });
      setError(e instanceof Error ? e.message : 'Could not refresh inbox.');
    } finally { loading.current = false; setRefreshing(false); }
  }
  useEffect(() => {
    if (!connected || !active || expired || !visible || settings) return;
    void refresh(identity); const timer = setInterval(() => void refresh(identity), 15000);
    return () => clearInterval(timer);
  }, [connected, identity.id, identity.email, active, expired, visible, settings]);
  function connect() {
    const profile = identity;
    let baseUrl: string;
    try { baseUrl = serviceUrl(endpoint); } catch (e) { setError((e as Error).message); return; }
    // Request optional host access directly in the user's click gesture.
    const permission = chrome.permissions.request({ origins: [`${new URL(baseUrl).protocol}//${new URL(baseUrl).hostname}/*`] });
    void perform(async () => {
      if (!await permission) throw new Error('Allow access to your mailbox service to connect.');
      await mailboxCommand({ action: 'connect', baseUrl, enrollmentCode: code });
      setConnected(true); setSettings(false); setCode('');
      if (!settings && (!active || expired)) {
        const mailbox = await mailboxCommand<MailboxInfo>({ action: 'create', identityId: profile.id });
        if (current.current.id === profile.id) await onChange({ ...profile, email: mailbox.address, mailbox: { status: 'active', id: mailbox.id, expiresAt: mailbox.expiresAt } });
        notify('Mailbox enabled. Access is saved for future mailboxes.');
      } else notify('Mailbox service connected.');
    });
  }
  async function provision() {
    const profile = identity;
    await perform(async () => {
      const mailbox = await mailboxCommand<MailboxInfo>({ action: 'create', identityId: profile.id });
      if (current.current.id !== profile.id) return;
      await onChange({ ...profile, email: mailbox.address, mailbox: { status: 'active', id: mailbox.id, expiresAt: mailbox.expiresAt } });
      notify('Mailbox enabled. The identity now uses its receiving address.');
    });
  }
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); notify('Copied.'); } catch { setError('Could not copy. Select the text manually.'); } }
  async function confirmAction() {
    const profile = identity, action = confirmation;
    if (profile.mailbox.status === 'test' || !action) return;
    const previousMailbox = profile.mailbox, mailboxId = previousMailbox.id;
    await perform(async () => {
      if (action === 'clear') {
        await mailboxCommand({ action: 'clear', mailboxId }); setMessages([]); setOpened(undefined); notify('Inbox cleared. Your email address stays active.');
      } else if (action === 'message' && opened) {
        await mailboxCommand({ action: 'deleteMessage', mailboxId, messageId: opened.id }); setMessages(items => items.filter(m => m.id !== opened.id)); setOpened(undefined); notify('Message deleted.');
      } else {
        await mailboxCommand({ action: 'delete', mailboxId });
        await onChange({ ...profile, mailbox: { ...previousMailbox, status: 'expired' } }); setMessages([]); setOpened(undefined);
        if (action === 'rotate') {
          const next = await mailboxCommand<MailboxInfo>({ action: 'create', identityId: profile.id });
          await onChange({ ...profile, email: next.address, mailbox: { status: 'active', id: next.id, expiresAt: next.expiresAt } });
          notify('New address ready. Fill your form again to use it.');
        } else notify('Mailbox deleted.');
      }
      setConfirmation(undefined);
    });
  }
  const confirmationText = confirmation === 'clear' ? 'Delete all messages? Your current address will keep receiving email.' : confirmation === 'rotate' ? 'Replace this address? The old inbox and its messages will be deleted. Forms already filled keep their old address.' : confirmation === 'message' ? 'Permanently delete this message?' : 'Delete this mailbox and all messages? The address will stop receiving email.';
  const connectionForm = <div className="mail-settings"><label>Access code<input aria-label="Mailbox access code" type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)}/></label><details><summary>Use a different service</summary><label>Service URL<input aria-label="Mailbox service URL" type="url" value={endpoint} onChange={e => setEndpoint(e.target.value)}/></label></details><button className="primary full" disabled={busy || !endpoint || !code || !globalThis.chrome?.runtime?.id} onClick={connect}>{busy ? 'Activating…' : settings ? 'Connect mailbox access' : 'Activate & create mailbox'}</button><p className="hint">One-time activation for this browser. Enabling an inbox replaces the identity’s test email with a receiving address.</p></div>;
  return <section className="card mailbox"><div className="cardhead"><h3>{settings ? 'Mailbox access' : active && !expired ? 'Messages' : 'Add an inbox'}</h3><span className="badge">{settings ? connected ? 'CONNECTED' : 'NOT CONNECTED' : active && !expired ? `${timeLeft} left` : expired ? 'EXPIRED' : 'OPTIONAL'}</span></div>
    {!connected && <p className="sub">Activate once to receive verification emails here.</p>}
    {!connected && connectionForm}
    {connected && settings && <><div className="connection-status"><i/><div><strong>Your inbox is connected</strong><p>Access is saved on this device. New identities can add an inbox without activating again.</p></div></div><details><summary>Change connection</summary>{connectionForm}</details></>}
    {connected && !settings && <>
      {(!active || expired) && <><p className="hint">Enabling a mailbox replaces mail ID {mailId(identity.email)} with a new receiving address. Forms already filled keep their previous value until you fill them again.</p><button className="primary full" disabled={busy} onClick={provision}>{expired ? 'Create replacement mailbox' : 'Enable mailbox & replace email'}</button></>}
      {active && box && !expired && <><div className="inbox-actions"><button disabled={busy} onClick={() => void copy(identity.email)}>Copy email</button><button disabled={busy || refreshing} onClick={() => void refresh()}>{refreshing ? 'Checking…' : 'Refresh'}</button><button disabled={busy} onClick={() => setConfirmation('rotate')}>New address</button><details className="inbox-more"><summary>More</summary><button disabled={busy || !messages.length} onClick={() => setConfirmation('clear')}>Clear messages</button><button disabled={busy} onClick={() => setConfirmation('mailbox')}>Delete mailbox</button><button disabled={busy} onClick={() => setSettings(true)}>Connection settings</button></details></div>
        <div className="inbox-status"><span>{messages.length} message{messages.length === 1 ? '' : 's'}</span><span>{lastRefresh ? `Updated ${lastRefresh}` : 'Auto-refresh on'}</span></div>
        <div className="inbox">{opened ? <article className="mail-detail"><button className="text-button" onClick={() => { setOpened(undefined); setConfirmation(undefined); }}>← Back to inbox</button><h3>{opened.subject || '(No subject)'}</h3><p className="hint">{opened.from}</p>{verificationCodes(opened.text || '').map(value => <button className="code-chip" key={value} onClick={() => void copy(value)}>Copy code {value}</button>)}<pre>{opened.text || 'This message has no plain-text body.'}</pre><button disabled={busy} onClick={() => setConfirmation('message')}>Delete message</button></article> : messages.length ? messages.map(message => <div className="mail-item" key={message.id}><button className="mail-row" disabled={busy} onClick={() => void perform(async () => { const detail = await mailboxCommand<MailMessage>({ action: 'message', mailboxId: box.id, messageId: message.id }); if (current.current.id === identity.id && current.current.email === identity.email) setOpened(detail); })}><strong>{message.subject || '(No subject)'}</strong><small>{message.from}</small><small>{new Date(message.receivedAt).toLocaleTimeString()}</small></button>{verificationCodes(message.preview || '').map(value => <button className="code-chip" key={value} onClick={() => void copy(value)}>Copy code {value}</button>)}</div>) : <div className="inbox-empty"><span>✉</span><h3>Waiting for your first email</h3><p>Use your address in a signup or test email.<br/>New messages appear here automatically.</p></div>}</div>
      </>}
      {(!active || expired) && <button className="text-button" disabled={busy} onClick={() => setSettings(true)}>Connection settings</button>}
    </>}
    {connected && settings && <><p className="hint">Disconnecting removes this browser’s access. Existing mailboxes remain until expiry; reconnecting creates a new installation.</p><div className="row"><button disabled={busy} onClick={() => setSettings(false)}>Back to inbox</button><button disabled={busy} onClick={() => void perform(async () => { await mailboxCommand({ action: 'disconnect' }); setConnected(false); setMessages([]); setOpened(undefined); setSettings(false); })}>Disconnect service</button></div></>}
    {error && <p className="callout" role="alert">{error}</p>}
    {confirmation && <div className="callout" role="alertdialog" aria-label="Confirm inbox action"><p>{confirmationText}</p><div className="row"><button disabled={busy} onClick={() => setConfirmation(undefined)}>Cancel</button><button disabled={busy} onClick={() => void confirmAction()}>{busy ? 'Working…' : confirmation === 'rotate' ? 'Replace address' : 'Delete permanently'}</button></div></div>}
  </section>;
}
