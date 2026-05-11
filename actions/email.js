// Nexus Email — compose, read, and send via macOS Mail.app or mailto: fallback
// Uses AppleScript for deep integration, falls back to mailto: URLs

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const contacts = require('./contacts');
const graph = require('../graph');

// Compose and send an email via Mail.app
async function email_send(params, ctx) {
  const { to, subject, body, attachment, cc, bcc } = params;
  
  if (!to) return { success: false, error: 'No recipient specified' };

  // Resolve recipient from contacts
  let recipient = to;
  const contactResults = contacts.lookupContact(to);
  if (contactResults.length > 0) {
    const c = contactResults[0];
    recipient = c.emails?.[0]?.address || to;
    console.log('[email] Resolved', to, '→', recipient);
  }

  // Resolve attachment path
  let attachmentPath = '';
  if (attachment) {
    const searchResult = await (require('./index').ACTION_MAP.file_search || 
      ((p) => require('./index').executeAction({ intent: 'query_file', params: p })))({ fileName: attachment });
    if (searchResult?.results?.length > 0) {
      attachmentPath = searchResult.results[0].path;
    }
  }

  const subjectText = subject || '(no subject)';
  const bodyText = body || '';

  return new Promise((resolve) => {
    // Use AppleScript to compose in Mail.app
    const escapedSubject = subjectText.replace(/"/g, '\\"').replace(/'/g, "'\\''");
    const escapedBody = bodyText.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const escapedTo = recipient.replace(/"/g, '\\"');
    const escapedAttach = attachmentPath.replace(/"/g, '\\"');

    let script = `
      tell application "Mail"
        set newMessage to make new outgoing message with properties {subject:"${escapedSubject}", content:"${escapedBody}", visible:true}
        tell newMessage
          make new to recipient at end of to recipients with properties {address:"${escapedTo}"}
    `;

    if (cc) script += `\n          make new cc recipient at end of cc recipients with properties {address:"${cc.replace(/"/g, '\\"')}"}`;
    if (bcc) script += `\n          make new bcc recipient at end of bcc recipients with properties {address:"${bcc.replace(/"/g, '\\"')}"}`;
    if (attachmentPath && fs.existsSync(attachmentPath)) {
      script += `\n          make new attachment with properties {file name:"${escapedAttach}"} at after last paragraph`;
    }
    
    script += `
        end tell
        activate
      end tell
    `;

    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 10000 }, (err) => {
      if (err) {
        // Fall back to mailto: URL
        console.log('[email] Mail.app failed, using mailto: fallback:', err.message);
        let mailto = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subjectText)}`;
        if (bodyText) mailto += `&body=${encodeURIComponent(bodyText)}`;
        if (cc) mailto += `&cc=${encodeURIComponent(cc)}`;
        if (bcc) mailto += `&bcc=${encodeURIComponent(bcc)}`;

        exec(`open "${mailto}"`, (err2) => {
          if (err2) return resolve({ success: false, error: err2.message });
          
          // Record in graph
          const personId = graph.upsertEntity('person', to, { metadata: { email: recipient } });
          graph.logInteraction({
            rawInput: ctx?.rawInput || `Email to ${to}`,
            intent: 'send_email',
            params: { to, subject: subjectText },
            action: 'email_send',
          });
          
          resolve({
            success: true,
            result: `Opened email composer to ${to}${attachmentPath ? ' with attachment' : ''}`,
            draftMode: true,
            recipient,
            subject: subjectText,
          });
        });
        return;
      }

      // Record in graph
      graph.upsertEntity('person', to, { metadata: { email: recipient } });
      graph.logInteraction({
        rawInput: ctx?.rawInput || `Email to ${to}`,
        intent: 'send_email',
        params: { to, subject: subjectText },
        action: 'email_send',
      });

      resolve({
        success: true,
        result: `Composed email to ${to}: "${subjectText}"`,
        draftMode: true,
        recipient,
        subject: subjectText,
      });
    });
  });
}

// Read recent emails
async function email_read(params, ctx) {
  const query = params.query || params.sender || '';
  const limit = params.limit || 10;

  return new Promise((resolve) => {
    let filterClause = '';
    if (query) {
      filterClause = `whose subject contains "${query.replace(/"/g, '\\"')}" or sender contains "${query.replace(/"/g, '\\"')}"`;
    }

    const script = `
      tell application "Mail"
        set results to {}
        set msgList to messages of inbox
        set msgCount to count of msgList
        set startIdx to msgCount - ${limit}
        if startIdx < 1 then set startIdx to 1
        
        repeat with i from startIdx to msgCount
          set msg to item i of msgList
          set msgData to "FROM:" & (sender of msg as string) & "|SUBJECT:" & (subject of msg as string) & "|DATE:" & (date received of msg as string) & "|READ:" & (read status of msg as string)
          set results to results & msgData & "\\n"
        end repeat
        return results as string
      end tell
    `;

    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 10000 }, (err, stdout) => {
      if (err) {
        return resolve({ success: false, error: 'Cannot access Mail.app', results: [] });
      }

      const emails = stdout.trim().split('\n').filter(Boolean).map(line => {
        const parts = {};
        line.split('|').forEach(p => {
          const [key, ...val] = p.split(':');
          parts[key] = val.join(':');
        });
        return {
          from: parts['FROM'] || '',
          subject: parts['SUBJECT'] || '',
          date: parts['DATE'] || '',
          read: parts['READ'] === 'true',
        };
      });

      resolve({ success: true, results: emails, count: emails.length });
    });
  });
}

module.exports = { email_send, email_read };
