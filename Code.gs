const SHEET_TASKS = 'Tasks';
const SHEET_USERS = 'Users';
const SHEET_SETTINGS = 'Settings';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Task Reminder')
    .addItem('Initialize Sheets', 'initializeTaskSystem')
    .addItem('Create Daily Trigger', 'createDailyTrigger')
    .addItem('Send Pending Tasks Now', 'sendDailyPendingTasks')
    .addItem('Test Template Send', 'testTemplateSend')
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
  SpreadsheetApp.getUi().alert('✓ Sheets initialized successfully!');
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

  SpreadsheetApp.getUi().alert('✓ Daily trigger created for 9:00 AM');
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
    ['TEMPLATE_NAME', 'daily_task_reminder'],
    ['TEMPLATE_LANGUAGE', 'en_US']
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
  return String(phone).replace(/\D/g, '').trim();
}

function getPendingTasksByUser() {
  const tasks = getTasks();
  const grouped = {};

  tasks.forEach(function(task) {
    const status = String(task.status || '').trim().toLowerCase();
    const phone = normalizePhoneNumber(task.assigneePhone);

    if (!phone) return;

    if (status === 'completed' || status === 'done' || status === 'closed') {
      return;
    }

    if (!grouped[phone]) {
      grouped[phone] = {
        name: task.assigneeName || 'User',
        tasks: []
      };
    }

    grouped[phone].tasks.push(task);
  });

  return grouped;
}

function sendWhatsAppTemplateMessage(phoneNumber, name, count, taskList) {
  const settings = getSettings();
  const token = String(settings.WHATSAPP_TOKEN || '').trim();
  const phoneNumberId = String(settings.PHONE_NUMBER_ID || '').trim();
  const apiVersion = String(settings.API_VERSION || 'v18.0').trim();
  const baseUrl = String(settings.API_BASE_URL || 'https://graph.facebook.com').trim();
  const templateName = String(settings.TEMPLATE_NAME || 'daily_task_reminder').trim();
  const templateLanguage = String(settings.TEMPLATE_LANGUAGE || 'en_US').trim();

  if (!token || !token.startsWith('E')) {
    throw new Error('Invalid WhatsApp token. Must start with E');
  }

  if (!phoneNumberId || phoneNumberId.length < 10) {
    throw new Error('Invalid Phone Number ID');
  }

  const cleanPhone = normalizePhoneNumber(phoneNumber);
  if (!cleanPhone || cleanPhone.length < 10) {
    throw new Error('Invalid phone number: ' + phoneNumber);
  }

  const url = baseUrl + '/' + apiVersion + '/' + phoneNumberId + '/messages';

  const payload = {
    messaging_product: "whatsapp",
    to: cleanPhone,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: templateLanguage
      },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: name },
            { type: "text", text: String(count) },
            { type: "text", text: taskList }
          ]
        }
      ]
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

  Logger.log('=== Sending Template Message ===');
  Logger.log('To: ' + cleanPhone);
  Logger.log('URL: ' + url);
  Logger.log('Template: ' + templateName);
  Logger.log('Payload: ' + JSON.stringify(payload, null, 2));

  const response = UrlFetchApp.fetch(url, options);
  const status = response.getResponseCode();
  const text = response.getContentText();

  Logger.log('Response Code: ' + status);
  Logger.log('Response Body: ' + text);

  if (status >= 400) {
    throw new Error('WhatsApp API Error ' + status + ': ' + text);
  }

  return JSON.parse(text || '{}');
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

  if (phoneIndex === -1 || reminderIndex === -1) return;

  const normalizedTargetPhone = normalizePhoneNumber(phoneNumber);
  for (let i = 1; i < values.length; i++) {
    const rowPhone = normalizePhoneNumber(values[i][phoneIndex]);
    if (rowPhone === normalizedTargetPhone) {
      sheet.getRange(i + 1, reminderIndex + 1).setValue(new Date());
    }
  }
}

function sendDailyPendingTasks() {
  try {
    Logger.log('========== STARTING DAILY PENDING TASKS ==========');

    const groupedTasks = getPendingTasksByUser();
    const userPhones = Object.keys(groupedTasks);

    Logger.log('Found ' + userPhones.length + ' users with pending tasks');

    if (!userPhones.length) {
      Logger.log('No pending tasks found');
      return;
    }

    let successCount = 0;
    let failureCount = 0;

    userPhones.forEach(function(phone) {
      const entry = groupedTasks[phone];

      const taskList = entry.tasks.map(function(task, index) {
        return (index + 1) + '. ' + task.taskName;
      }).join('\n');

      Logger.log('\n--- Processing: ' + entry.name + ' (' + phone + ') ---');
      Logger.log('Tasks: ' + entry.tasks.length);
      Logger.log('Task List:\n' + taskList);

      try {
        sendWhatsAppTemplateMessage(phone, entry.name, entry.tasks.length, taskList);
        markReminderSentForTasks(phone);
        Logger.log('✅ SUCCESS - Message sent to ' + phone);
        successCount++;
      } catch (error) {
        Logger.log('❌ FAILED - ' + error.message);
        failureCount++;
      }
    });

    Logger.log('\n========== DAILY REMINDER COMPLETED ==========');
    Logger.log('Success: ' + successCount + ' | Failed: ' + failureCount);
    Logger.log('============================================');

  } catch (error) {
    Logger.log('❌ FATAL ERROR: ' + error.message);
  }
}

function testTemplateSend() {
  try {
    Logger.log('=== Testing Template Send ===');
    const groupedTasks = getPendingTasksByUser();
    const firstPhone = Object.keys(groupedTasks)[0];

    if (!firstPhone) {
      SpreadsheetApp.getUi().alert('❌ No pending tasks found in Tasks sheet');
      return;
    }

    const entry = groupedTasks[firstPhone];
    const taskList = entry.tasks.map(function(task, index) {
      return (index + 1) + '. ' + task.taskName;
    }).join('\n');

    Logger.log('Test recipient: ' + entry.name + ' (' + firstPhone + ')');
    Logger.log('Task count: ' + entry.tasks.length);
    Logger.log('Task list:\n' + taskList);

    sendWhatsAppTemplateMessage(firstPhone, entry.name, entry.tasks.length, taskList);

    SpreadsheetApp.getUi().alert('✅ Test message sent to ' + firstPhone + '\n\nCheck Execution Log for details');

  } catch (error) {
    Logger.log('❌ Test failed: ' + error.message);
    SpreadsheetApp.getUi().alert('❌ Test failed:\n' + error.message);
  }
}
