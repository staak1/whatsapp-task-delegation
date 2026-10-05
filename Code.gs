const SHEET_TASKS = 'Tasks';
const SHEET_USERS = 'Users';
const SHEET_SETTINGS = 'Settings';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Task Reminder')
    .addItem('Initialize Sheets', 'initializeTaskSystem')
    .addItem('Create Daily Trigger', 'createDailyTrigger')
    .addItem('Send Pending Tasks Now', 'sendDailyPendingTasks')
    .addItem('Test Message Preview', 'testMessage')
    .addToUi();
}

function initializeTaskSystem() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const tasksSheet = getOrCreateSheet(spreadsheet, SHEET_TASKS);
  const usersSheet = getOrCreateSheet(spreadsheet, SHEET_USERS);
  const settingsSheet = getOrCreateSheet(spreadsheet, SHEET_SETTINGS);

  ensureHeaders(tasksSheet, [
    'Task ID',
    'Task Name',
    'Assignee Name',
    'Assignee Phone',
    'Status',
    'Priority',
    'Due Date',
    'Created Date',
    'Last Reminder Sent',
    'Notes'
  ]);

  ensureHeaders(usersSheet, [
    'Employee Name',
    'Phone',
    'Team',
    'Active',
    'WhatsApp Enabled'
  ]);

  ensureHeaders(settingsSheet, [
    'Key',
    'Value'
  ]);

  ensureDefaultSettings(settingsSheet);

  SpreadsheetApp.flush();
  SpreadsheetApp.getUi().alert('✓ Sheets initialized successfully!\n\nNext steps:\n1. Update Settings tab with WhatsApp credentials\n2. Add tasks to Tasks tab\n3. Click "Send Pending Tasks Now" to test');
}

function createDailyTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  const alreadyExists = triggers.some(function(trigger) {
    return trigger.getHandlerFunction() === 'sendDailyPendingTasks';
  });

  if (alreadyExists) {
    SpreadsheetApp.getUi().alert('⚠ Daily trigger already exists.');
    return;
  }

  ScriptApp.newTrigger('sendDailyPendingTasks')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .nearMinute(0)
    .create();

  SpreadsheetApp.getUi().alert('✓ Daily trigger created for 9:00 AM IST');
}

function ensureHeaders(sheet, headers) {
  const existing = sheet.getDataRange().getValues();
  if (!existing.length) {
    sheet.appendRow(headers);
    return;
  }

  const firstRow = existing[0];
  for (let i = 0; i < headers.length; i++) {
    if (!firstRow[i]) {
      sheet.getRange(1, i + 1).setValue(headers[i]);
    }
  }
}

function getOrCreateSheet(spreadsheet, name) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }
  return sheet;
}

function ensureDefaultSettings(settingsSheet) {
  const defaults = [
    ['WHATSAPP_TOKEN', 'YOUR_WHATSAPP_BEARER_TOKEN'],
    ['PHONE_NUMBER_ID', 'YOUR_PHONE_NUMBER_ID'],
    ['API_VERSION', 'v18.0'],
    ['API_BASE_URL', 'https://graph.facebook.com'],
    ['SCHEDULE_HOUR', '9'],
    ['MESSAGE_TEMPLATE', 'Hello {name},\n\nYou have {count} pending task(s):\n\n{task_list}\n\nPlease complete these today.']
  ];

  const existing = settingsSheet.getDataRange().getValues();
  const keys = {};
  for (let i = 1; i < existing.length; i++) {
    const key = String(existing[i][0] || '').trim();
    if (key) {
      keys[key] = true;
    }
  }

  for (let i = 0; i < defaults.length; i++) {
    const key = defaults[i][0];
    if (!keys[key]) {
      settingsSheet.appendRow(defaults[i]);
    }
  }
}

function getSettings() {
  const settingsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SETTINGS);
  const values = settingsSheet.getDataRange().getValues();
  const settings = {};

  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][0] || '').trim();
    const value = values[i][1];
    if (key) {
      settings[key] = value;
    }
  }

  return settings;
}

function getTasks() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TASKS);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];

  const headers = values[0].map(function(value) {
    return String(value || '').trim();
  });

  const rows = values.slice(1);
  return rows
    .filter(function(row) {
      return row.some(function(cell) {
        return cell !== '' && cell !== null && cell !== undefined;
      });
    })
    .map(function(row) {
      const task = {};
      for (let i = 0; i < headers.length; i++) {
        task[headers[i]] = row[i];
      }
      return {
        taskId: task['Task ID'],
        taskName: task['Task Name'],
        assigneeName: task['Assignee Name'],
        assigneePhone: task['Assignee Phone'],
        status: task['Status'],
        priority: task['Priority'],
        dueDate: task['Due Date'],
        createdDate: task['Created Date'],
        lastReminderSent: task['Last Reminder Sent'],
        notes: task['Notes']
      };
    });
}

function normalizePhoneNumber(phone) {
  if (!phone) return '';
  return String(phone)
    .replace(/[^0-9+]/g, '')
    .replace(/^00/, '+')
    .trim();
}

function formatDate(value) {
  if (!value) {
    return 'Not specified';
  }

  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }

  const dateValue = new Date(value);
  if (!isNaN(dateValue.getTime())) {
    return dateValue.toISOString().split('T')[0];
  }

  return String(value);
}

function getPendingTasksByUser() {
  const tasks = getTasks();
  const grouped = {};

  tasks.forEach(function(task) {
    const status = String(task.status || '').trim().toLowerCase();
    const phone = normalizePhoneNumber(task.assigneePhone);

    if (!phone) {
      return;
    }

    if (status === 'completed' || status === 'done' || status === 'closed') {
      return;
    }

    const userKey = phone;
    if (!grouped[userKey]) {
      grouped[userKey] = {
        name: task.assigneeName || 'User',
        tasks: []
      };
    }

    grouped[userKey].tasks.push(task);
  });

  return grouped;
}

function buildWhatsAppMessage(name, tasks) {
  const settings = getSettings();
  const template = settings.MESSAGE_TEMPLATE || 'Hello {name}, you have {count} pending task(s):\n{task_list}\nPlease complete these today.';

  const taskList = tasks.map(function(task, index) {
    const dueDate = task.dueDate ? ' (Due: ' + formatDate(task.dueDate) + ')' : '';
    return (index + 1) + '. ' + (task.taskName || 'Untitled task') + dueDate;
  }).join('\n');

  return template
    .replace('{name}', name)
    .replace('{count}', tasks.length)
    .replace('{task_list}', taskList);
}

function sendWhatsAppMessage(phoneNumber, messageBody) {
  const settings = getSettings();
  const token = String(settings.WHATSAPP_TOKEN || '').trim();
  const phoneNumberId = String(settings.PHONE_NUMBER_ID || '').trim();
  const apiVersion = String(settings.API_VERSION || 'v18.0').trim();
  const baseUrl = String(settings.API_BASE_URL || 'https://graph.facebook.com').trim();

  if (!token || token.indexOf('YOUR_') !== -1) {
    throw new Error('WhatsApp token is missing or invalid. Update the Settings sheet with a valid token.');
  }

  if (!phoneNumberId || phoneNumberId.indexOf('YOUR_') !== -1) {
    throw new Error('WhatsApp Phone Number ID is missing or invalid. Update the Settings sheet.');
  }

  const url = baseUrl + '/' + apiVersion + '/' + phoneNumberId + '/messages';
  const payload = {
    messaging_product: 'whatsapp',
    to: normalizePhoneNumber(phoneNumber),
    type: 'text',
    text: {
      body: messageBody
    }
  };

  const options = {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode >= 400) {
    const errorMsg = 'Error: ' + responseCode + ' - ' + responseText;
    Logger.log(errorMsg);
    throw new Error(errorMsg);
  }

  return JSON.parse(responseText || '{}');
}

function markReminderSentForTasks(phoneNumber) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TASKS);
  const values = sheet.getDataRange().getValues();
  if (!values.length) return;

  const headers = values[0].map(function(value) {
    return String(value || '').trim();
  });

  const phoneIndex = headers.indexOf('Assignee Phone');
  const reminderIndex = headers.indexOf('Last Reminder Sent');

  if (phoneIndex === -1 || reminderIndex === -1) {
    return;
  }

  const normalizedTargetPhone = normalizePhoneNumber(phoneNumber);
  for (let i = 1; i < values.length; i++) {
    const rowPhone = normalizePhoneNumber(values[i][phoneIndex]);
    if (rowPhone === normalizedTargetPhone) {
      const cell = sheet.getRange(i + 1, reminderIndex + 1);
      cell.setValue(new Date());
    }
  }
}

function sendDailyPendingTasks() {
  try {
    const groupedTasks = getPendingTasksByUser();
    const userPhones = Object.keys(groupedTasks);

    if (!userPhones.length) {
      Logger.log('No pending tasks found for any user.');
      return;
    }

    let successCount = 0;
    let failureCount = 0;

    userPhones.forEach(function(phone) {
      const entry = groupedTasks[phone];
      const message = buildWhatsAppMessage(entry.name, entry.tasks);
      try {
        sendWhatsAppMessage(phone, message);
        markReminderSentForTasks(phone);
        Logger.log('✓ Message sent to ' + phone);
        successCount++;
      } catch (error) {
        Logger.log('✗ Failed to send message to ' + phone + ': ' + error.message);
        failureCount++;
      }
    });

    Logger.log('Daily reminder run completed - Success: ' + successCount + ', Failed: ' + failureCount);
  } catch (error) {
    Logger.log('Error in sendDailyPendingTasks: ' + error.message);
  }
}

function testMessage() {
  try {
    const groupedTasks = getPendingTasksByUser();
    const firstPhone = Object.keys(groupedTasks)[0];
    if (!firstPhone) {
      SpreadsheetApp.getUi().alert('❌ No pending tasks found.\n\nAdd tasks to the Tasks sheet with:\n- Status: Pending (or not Completed)\n- Assignee Phone: Valid number');
      return;
    }

    const entry = groupedTasks[firstPhone];
    const testMessage = buildWhatsAppMessage(entry.name, entry.tasks);
    SpreadsheetApp.getUi().alert('📨 Sample message preview:\n\n' + testMessage + '\n\nWill be sent to: ' + firstPhone);
  } catch (error) {
    SpreadsheetApp.getUi().alert('❌ Error: ' + error.message);
  }
}
