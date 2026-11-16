import { handleMailCommand, MailApiError } from './mail-api';
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(console.error);
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'rapidmock:mail' || sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  handleMailCommand(message.command).then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Mailbox request failed.', status: error instanceof MailApiError ? error.status : 0 }));
  return true;
});
