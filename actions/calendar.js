// Nexus Calendar — read and create events via macOS Calendar.app
// Uses AppleScript for deep integration

const { exec } = require('child_process');
const graph = require('../graph');

// Query calendar events
async function calendar_query(params, ctx) {
  const timeRange = params.timeRange || params.when || 'today';
  
  return new Promise((resolve) => {
    let dateFilter;
    const now = new Date();
    
    switch (timeRange.toLowerCase()) {
      case 'today':
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
        dateFilter = `(start date ≥ date "${todayStart.toISOString().split('T')[0]}" and start date < date "${todayEnd.toISOString().split('T')[0]}")`;
        break;
      case 'tomorrow':
        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const tomorrowEnd = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000);
        dateFilter = `(start date ≥ date "${tomorrow.toISOString().split('T')[0]}" and start date < date "${tomorrowEnd.toISOString().split('T')[0]}")`;
        break;
      case 'this week':
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 7);
        dateFilter = `(start date ≥ date "${weekStart.toISOString().split('T')[0]}" and start date < date "${weekEnd.toISOString().split('T')[0]}")`;
        break;
      default:
        dateFilter = `(start date ≥ (current date))`;
    }

    const script = `
      tell application "Calendar"
        set results to {}
        repeat with cal in every calendar
          try
            set eventList to (every event of cal whose ${dateFilter})
            repeat with ev in eventList
              set evData to "TITLE:" & (summary of ev as string) & "|START:" & (start date of ev as string) & "|END:" & (end date of ev as string) & "|LOCATION:" & (location of ev as string) & "|CALENDAR:" & (name of cal as string)
              try
                set evData to evData & "|NOTES:" & (description of ev as string)
              end try
              set results to results & evData & "\\n"
            end repeat
          end try
        end repeat
        return results as string
      end tell
    `;

    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 10000 }, (err, stdout) => {
      if (err) {
        return resolve({ success: false, error: 'Cannot access Calendar.app', events: [] });
      }

      const events = stdout.trim().split('\n').filter(Boolean).map(line => {
        const parts = {};
        line.split('|').forEach(p => {
          const idx = p.indexOf(':');
          if (idx > 0) parts[p.slice(0, idx)] = p.slice(idx + 1);
        });
        return {
          title: parts['TITLE'] || 'Untitled',
          start: parts['START'] || '',
          end: parts['END'] || '',
          location: parts['LOCATION'] || '',
          calendar: parts['CALENDAR'] || '',
          notes: parts['NOTES'] || '',
        };
      }).sort((a, b) => new Date(a.start) - new Date(b.start));

      // Register events in graph
      for (const ev of events) {
        graph.upsertEntity('event', ev.title, {
          metadata: { start: ev.start, end: ev.end, location: ev.location, calendar: ev.calendar },
        });
      }

      resolve({ success: true, events, count: events.length, timeRange });
    });
  });
}

// Create a calendar event
async function calendar_create(params, ctx) {
  const { title, date, time, duration, location, notes, participants } = params;
  
  if (!title) return { success: false, error: 'No event title provided' };

  // Parse date/time
  let startDate;
  if (date) {
    startDate = new Date(date + (time ? 'T' + time : 'T09:00'));
  } else {
    startDate = new Date();
    startDate.setHours(startDate.getHours() + 1, 0, 0, 0); // default: 1 hour from now
  }

  const durationMinutes = duration || 60;
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  const escapedTitle = title.replace(/"/g, '\\"');
  const escapedLocation = (location || '').replace(/"/g, '\\"');
  const escapedNotes = (notes || '').replace(/"/g, '\\"').replace(/\n/g, '\\n');

  const startStr = startDate.toISOString().replace('T', ' ').slice(0, 19);
  const endStr = endDate.toISOString().replace('T', ' ').slice(0, 19);

  return new Promise((resolve) => {
    const script = `
      tell application "Calendar"
        tell calendar "Work"
          make new event with properties {summary:"${escapedTitle}", start date:date "${startStr}", end date:date "${endStr}", description:"${escapedNotes}", location:"${escapedLocation}"}
        end tell
      end tell
    `;

    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 10000 }, (err) => {
      if (err) {
        // Fallback: create .ics file and open it
        const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:${startDate.toISOString().replace(/[-:]/g, '').split('.')[0]}Z
DTEND:${endDate.toISOString().replace(/[-:]/g, '').split('.')[0]}Z
SUMMARY:${title}
LOCATION:${location || ''}
DESCRIPTION:${notes || ''}
END:VEVENT
END:VCALENDAR`;

        const fs = require('fs');
        const tmpPath = `/tmp/nexus-event-${Date.now()}.ics`;
        fs.writeFileSync(tmpPath, icsContent);
        exec(`open "${tmpPath}"`, (err2) => {
          if (err2) return resolve({ success: false, error: err2.message });
          graph.upsertEntity('event', title, {
            metadata: { start: startStr, end: endStr, location, notes },
          });
          resolve({
            success: true,
            result: `Created event "${title}" on ${startDate.toLocaleDateString()} at ${startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
            fallbackIcs: true,
          });
        });
        return;
      }

      graph.upsertEntity('event', title, {
        metadata: { start: startStr, end: endStr, location, notes },
      });

      resolve({
        success: true,
        result: `Created event "${title}" on ${startDate.toLocaleDateString()} at ${startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      });
    });
  });
}

module.exports = { calendar_query, calendar_create };
