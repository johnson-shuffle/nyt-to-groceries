/**
 * Google Apps Script backend for Groceries & NYT Cooking automation.
 * Organizes groceries in a store-walking loop with LLM (Gemini) categorization
 * and high-histamine allergen flagging.
 */

const CONFIG = {
  TASK_LIST_NAME: "Groceries",

  // Loop around the store in walking order
  DEPARTMENTS: [
    "🥦 Produce",
    "🥖 Bakery & Deli",
    "🍷 Wine & Beer",
    "🥩 Meat & Seafood",
    "🥨 Snacks",
    "🧀 Dairy & Refrigerated",
    "❄️ Frozen",
    "🧴 Household",
    "🥫 Dry Goods",
    "🥤 Beverages"
  ],

  // Recurring staples pre-sorted by store walking loop
  STAPLES_BY_DEPARTMENT: {
    "🥦 Produce": [
      "Bananas",
      "Greens",
      "Cucumbers",
      "Peppers",
      "Red Onion"
    ],
    "🥖 Bakery & Deli": [
      "Bread",
      "Turkey"
    ],
    "🍷 Wine & Beer": [
      "Vino"
    ],
    "🥩 Meat & Seafood": [
      "Salmon",
      "Chicken / Steak / Pork"
    ],
    "🥨 Snacks": [
      "Chips"
    ],
    "🧀 Dairy & Refrigerated": [
      "String cheese",
      "Half n Half",
      "Iced Coffee"
    ],
    "❄️ Frozen": [
      "Pizza"
    ],
    "🧴 Household": [],
    "🥫 Dry Goods": [],
    "🥤 Beverages": [
      "Soda water",
      "Diet Pepsi",
      "Coconut Water"
    ]
  }
};

// Helper to normalize department names (strips emojis and extra spaces for matching)
function normalizeName(str) {
  return (str || "").replace(/[^\w\s&]/g, "").trim().toLowerCase();
}

// --- Google Tasks API Helper ---

const TasksAPI = {
  getToken: function () {
    return ScriptApp.getOAuthToken();
  },

  listTaskLists: function () {
    if (typeof Tasks !== "undefined" && Tasks.Tasklists) {
      return Tasks.Tasklists.list({ maxResults: 100 });
    }
    const url = "https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100";
    const res = UrlFetchApp.fetch(url, {
      headers: { Authorization: "Bearer " + this.getToken() }
    });
    return JSON.parse(res.getContentText());
  },

  createTaskList: function (title) {
    if (typeof Tasks !== "undefined" && Tasks.Tasklists) {
      return Tasks.Tasklists.insert({ title: title });
    }
    const url = "https://tasks.googleapis.com/tasks/v1/users/@me/lists";
    const res = UrlFetchApp.fetch(url, {
      method: "POST",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + this.getToken() },
      payload: JSON.stringify({ title: title })
    });
    return JSON.parse(res.getContentText());
  },

  listTasks: function (listId) {
    if (typeof Tasks !== "undefined" && Tasks.Tasks) {
      return Tasks.Tasks.list(listId, {
        showCompleted: false,
        showHidden: false,
        maxResults: 100
      });
    }
    const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks?showCompleted=false&showHidden=false&maxResults=100`;
    const res = UrlFetchApp.fetch(url, {
      headers: { Authorization: "Bearer " + this.getToken() }
    });
    return JSON.parse(res.getContentText());
  },

  insertTask: function (listId, taskData, parentId) {
    if (typeof Tasks !== "undefined" && Tasks.Tasks) {
      const opts = parentId ? { parent: parentId } : {};
      return Tasks.Tasks.insert(taskData, listId, opts);
    }
    let url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`;
    if (parentId) {
      url += `?parent=${encodeURIComponent(parentId)}`;
    }
    const res = UrlFetchApp.fetch(url, {
      method: "POST",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + this.getToken() },
      payload: JSON.stringify(taskData)
    });
    return JSON.parse(res.getContentText());
  }
};

/**
 * Finds existing "Groceries" task list or creates it.
 */
function getOrCreateGroceriesList() {
  const response = TasksAPI.listTaskLists();
  if (response.items && response.items.length > 0) {
    for (let i = 0; i < response.items.length; i++) {
      if (response.items[i].title.trim().toLowerCase() === CONFIG.TASK_LIST_NAME.toLowerCase()) {
        return response.items[i].id;
      }
    }
  }

  const newList = TasksAPI.createTaskList(CONFIG.TASK_LIST_NAME);
  Logger.log("Created task list: " + newList.title + " (ID: " + newList.id + ")");
  return newList.id;
}

/**
 * Ensures standing department parent tasks exist in the walking loop order.
 * Inserts in reverse order so Google Tasks displays them top-to-bottom as defined.
 */
function getOrCreateDepartments(listId) {
  const tasksResponse = TasksAPI.listTasks(listId);
  const existingItems = tasksResponse.items || [];

  // Map existing top-level tasks (no parent)
  const deptMap = {};
  for (const t of existingItems) {
    if (!t.parent) {
      deptMap[normalizeName(t.title)] = t.id;
    }
  }

  // Create missing departments in reverse order so they appear top-to-bottom
  const missingDepts = CONFIG.DEPARTMENTS.filter(d => !deptMap[normalizeName(d)]);
  for (const dept of missingDepts.slice().reverse()) {
    const created = TasksAPI.insertTask(listId, { title: dept });
    deptMap[normalizeName(dept)] = created.id;
  }

  const result = {};
  for (const dept of CONFIG.DEPARTMENTS) {
    result[dept] = deptMap[normalizeName(dept)];
  }
  return result;
}

/**
 * Classifies a list of recipe ingredients into store departments and flags
 * high-histamine fruits & vegetables using Gemini 2.5 Flash.
 */
function classifyIngredientsWithGemini(ingredients) {
  const apiKey = (PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "").trim();
  const defaultDept = "🥫 Dry Goods";

  if (!apiKey) {
    Logger.log("ERROR: GEMINI_API_KEY not found in Script Properties!");
    return {
      success: false,
      error: "GEMINI_API_KEY is empty or missing in Script Properties",
      items: ingredients.map(ing => ({
        ingredient: ing,
        department: defaultDept,
        isHighHistamine: false,
        reason: ""
      }))
    };
  }

  const validDeptsList = CONFIG.DEPARTMENTS.map(d => `"${d}"`).join(", ");
  const prompt = `You are a culinary assistant analyzing grocery ingredients.
1. Categorize each ingredient into exactly one of these store departments:
${validDeptsList}

2. Evaluate for HIGH-HISTAMINE fruits, vegetables, and their derivatives.
High-histamine produce includes:
- Tomatoes (fresh, sauce, paste, canned, sun-dried)
- Citrus (lemons, limes, oranges, grapefruit, zest, juice)
- Avocados / guacamole
- Strawberries
- Spinach
- Eggplant
- Fermented / pickled vegetables (sauerkraut, kimchi, pickles)
- Dried fruits (raisins, prunes, dates)

Ingredients to analyze:
${JSON.stringify(ingredients)}

Respond with a JSON array where each element has:
- "ingredient": original ingredient string
- "department": one of the exact department names listed above (including emoji if possible)
- "isHighHistamine": boolean (true if it contains high-histamine produce, false otherwise)
- "reason": brief string explaining the allergen if isHighHistamine is true (e.g. "Citrus (lime juice)", "Tomatoes"), or empty string if false

Example response:
[
  {"ingredient": "2 tbsp lime juice", "department": "🥦 Produce", "isHighHistamine": true, "reason": "Citrus (lime)"},
  {"ingredient": "1 lb boneless chicken thighs", "department": "🥩 Meat & Seafood", "isHighHistamine": false, "reason": ""}
]`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  try {
    const res = UrlFetchApp.fetch(url, {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1
        }
      }),
      muteHttpExceptions: true
    });

    const statusCode = res.getResponseCode();
    const content = res.getContentText();

    if (statusCode !== 200) {
      Logger.log(`Gemini API Error (HTTP ${statusCode}): ${content}`);
      return {
        success: false,
        error: `Gemini HTTP ${statusCode}: ${content}`,
        items: ingredients.map(ing => ({
          ingredient: ing,
          department: defaultDept,
          isHighHistamine: false,
          reason: ""
        }))
      };
    }

    const resJson = JSON.parse(content);
    const textOutput = resJson.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(textOutput);

    let rawList = [];
    if (Array.isArray(parsed)) {
      rawList = parsed;
    } else if (parsed && typeof parsed === "object") {
      const arr = Object.values(parsed).find(v => Array.isArray(v));
      if (arr) rawList = arr;
    }

    if (rawList.length === 0) {
      Logger.log("Could not find array in Gemini response: " + textOutput);
      return {
        success: false,
        error: "Unrecognized Gemini JSON structure",
        items: ingredients.map(ing => ({
          ingredient: ing,
          department: defaultDept,
          isHighHistamine: false,
          reason: ""
        }))
      };
    }

    return {
      success: true,
      items: rawList
    };

  } catch (err) {
    Logger.log("Exception calling Gemini: " + err.toString());
    return {
      success: false,
      error: err.toString(),
      items: ingredients.map(ing => ({
        ingredient: ing,
        department: defaultDept,
        isHighHistamine: false,
        reason: ""
      }))
    };
  }
}

/**
 * Finds matching department task ID by comparing normalized names.
 */
function matchDepartmentId(deptName, deptMap) {
  const norm = normalizeName(deptName);
  
  // 1. Direct match by normalized name
  for (const [knownDept, id] of Object.entries(deptMap)) {
    if (normalizeName(knownDept) === norm) {
      return id;
    }
  }

  // 2. Partial containment match
  for (const [knownDept, id] of Object.entries(deptMap)) {
    const knownNorm = normalizeName(knownDept);
    if (knownNorm.includes(norm) || norm.includes(knownNorm)) {
      return id;
    }
  }

  // 3. Fallback to Dry Goods
  return deptMap["🥫 Dry Goods"] || Object.values(deptMap)[0];
}

/**
 * Inserts recurring staples under their respective department parent tasks.
 * Inserts items in reverse order so Google Tasks displays them top-to-bottom as defined.
 * Avoids re-adding items if an uncompleted task already exists in that department.
 */
function populateWeeklyStaples() {
  const listId = getOrCreateGroceriesList();
  const deptMap = getOrCreateDepartments(listId);
  const tasksResponse = TasksAPI.listTasks(listId);
  const allTasks = tasksResponse.items || [];

  // Group existing subtasks by parent ID
  const existingByParent = {};
  for (const t of allTasks) {
    if (t.parent) {
      if (!existingByParent[t.parent]) existingByParent[t.parent] = new Set();
      existingByParent[t.parent].add(t.title.trim().toLowerCase());
    }
  }

  let addedCount = 0;
  for (const [dept, items] of Object.entries(CONFIG.STAPLES_BY_DEPARTMENT)) {
    const parentId = deptMap[dept];
    if (!parentId || !items || items.length === 0) continue;

    const existingInDept = existingByParent[parentId] || new Set();

    // Reverse items array during insertion so first item ends up at the top
    for (const item of items.slice().reverse()) {
      if (!existingInDept.has(item.trim().toLowerCase())) {
        TasksAPI.insertTask(listId, { title: item }, parentId);
        addedCount++;
      }
    }
  }

  Logger.log(`Populated weekly staples: added ${addedCount} items across departments.`);
}

/**
 * Webhook endpoint for the recipe bookmarklet.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "error",
        message: "No request body provided"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const payload = JSON.parse(e.postData.contents);
    const title = payload.title || "Untitled Recipe";
    const url = payload.url || "";
    const ingredients = Array.isArray(payload.ingredients) ? payload.ingredients : [];

    if (ingredients.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "No ingredients to add"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 1. Prepare Google Tasks & check for existing ingredients from this recipe
    const listId = getOrCreateGroceriesList();
    const deptMap = getOrCreateDepartments(listId);
    const existingTasks = TasksAPI.listTasks(listId).items || [];

    const baseUrl = url ? url.split("?")[0].split("#")[0].trim().toLowerCase() : "";
    const recipeHeader = `recipe: ${title.trim().toLowerCase()}`;
    const existingRecipeItems = new Set();

    for (const t of existingTasks) {
      if (!t.parent || !t.title) continue;
      const notesLower = (t.notes || "").toLowerCase();
      const isSameRecipe = (baseUrl && notesLower.includes(baseUrl)) || notesLower.includes(recipeHeader);
      if (isSameRecipe) {
        const cleanTitle = t.title.replace(/^‼️\s*/, "").trim().toLowerCase();
        existingRecipeItems.add(cleanTitle);
      }
    }

    const newIngredients = ingredients.filter(
      ing => !existingRecipeItems.has(ing.trim().toLowerCase())
    );

    if (newIngredients.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        recipe: title,
        itemsAdded: 0,
        itemsSkipped: ingredients.length,
        message: "All ingredients for this recipe are already in the list"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. Classify new ingredients & flag high histamine using Gemini
    const geminiResult = classifyIngredientsWithGemini(newIngredients);
    const classifiedItems = geminiResult.items;

    // 3. Insert each ingredient under its department
    let addedCount = 0;
    let skippedCount = ingredients.length - newIngredients.length;
    for (const item of classifiedItems.slice().reverse()) {
      const cleanIng = (item.ingredient || "").trim().toLowerCase();
      if (existingRecipeItems.has(cleanIng)) {
        skippedCount++;
        continue;
      }

      const parentId = matchDepartmentId(item.department, deptMap);
      const isAlert = Boolean(item.isHighHistamine);
      const prefix = isAlert ? "‼️ " : "";
      const taskTitle = `${prefix}${item.ingredient}`;

      let taskNotes = url ? `Recipe: ${title}\n${url}` : `Recipe: ${title}`;
      if (isAlert && item.reason) {
        taskNotes = `High-Histamine Produce: ${item.reason}\n${taskNotes}`;
      }

      TasksAPI.insertTask(listId, {
        title: taskTitle,
        notes: taskNotes
      }, parentId);
      existingRecipeItems.add(cleanIng);
      addedCount++;
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      recipe: title,
      itemsAdded: addedCount,
      itemsSkipped: skippedCount,
      geminiSuccess: geminiResult.success,
      geminiError: geminiResult.error || null,
      classifications: classifiedItems
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log("Error in doPost: " + err.toString());
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Diagnostic test function: Run this directly in the Apps Script editor
 * to verify Gemini classification and high-histamine detection.
 */
function testGemini() {
  const sample = [
    "1 lb boneless chicken thighs",
    "2 fresh avocados",
    "2 tbsp fresh lemon juice",
    "1 can crushed tomatoes",
    "1 box cheddar crackers",
    "1 gallon whole milk"
  ];
  const result = classifyIngredientsWithGemini(sample);
  Logger.log("Test Result: " + JSON.stringify(result, null, 2));
}

/**
 * Lists all models supported by your API key.
 */
function listAvailableModels() {
  const apiKey = (PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "").trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() === 200) {
    const data = JSON.parse(res.getContentText());
    const valid = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map(m => m.name.replace("models/", ""));
    Logger.log("Available generateContent models:\n" + valid.join("\n"));
  } else {
    Logger.log("Error listing models: " + res.getContentText());
  }
}

/**
 * Sets up weekly Sunday 7:00 AM trigger.
 */
function installSundayTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === "populateWeeklyStaples") {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  ScriptApp.newTrigger("populateWeeklyStaples")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(7)
    .create();

  Logger.log("Successfully installed Sunday 7:00 AM trigger for populateWeeklyStaples.");
}
