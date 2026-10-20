# 🛒 NYT to Groceries

Automate your grocery planning and walk the grocery store like a pro! 🏃‍♂️💨

**NYT to Groceries** connects your favorite recipes from NYT Cooking directly into **Google Tasks**, organized by store aisle walking loop so you never have to backtrack for forgotten cilantro.

---

## ✨ Features

- 🪄 **1-Click Recipe Extractor**: A browser bookmarklet grabs ingredients directly from any NYT Cooking recipe paywall-free from your active tab.
- 🧠 **AI Store-Aisle Sorting**: Uses Google Gemini to classify recipe ingredients into 10 store departments arranged in the exact order you walk the store.
- 🔁 **Sunday Staples Auto-Fill**: Automatically populates your weekly recurring essentials every Sunday morning at 7:00 AM—skipping duplicates.
- 🚨 **Histamine Radar**: Flags high-histamine produce (like spinach, tomatoes, and avocados) with `‼️` and adds detailed notes to keep sensitivities in check.

---

## 🏬 The Store Walking Loop

Google Tasks supports one level of subtasks, so each store aisle acts as a parent task:

1. 🥦 **Produce**
2. 🥖 **Bakery & Deli**
3. 🍷 **Wine & Beer**
4. 🥩 **Meat & Seafood**
5. 🥨 **Snacks**
6. 🧀 **Dairy & Refrigerated**
7. ❄️ **Frozen**
8. 🧴 **Household**
9. 🥫 **Dry Goods**
10. 🥤 **Beverages**

Every item (staple or recipe ingredient) slots neatly underneath its department parent.

---

## 📁 Repository Structure

```text
nyt-to-groceries/
├── appsscript/
│   ├── Code.js                 # Apps Script backend (Gemini LLM + Google Tasks API + Webhook)
│   └── appsscript.json         # Apps Script manifest and OAuth scopes
├── client/
│   ├── bookmarklet.js          # Reference source code for the bookmarklet
│   └── install-bookmarklet.html# Interactive drag-and-drop bookmarklet generator
└── README.md
```

---

## 🚀 Quick Setup

1. **Deploy Backend**: Deploy `appsscript/` as a Google Apps Script Web App (executed as you, accessible to anyone).
2. **Set Script Properties**:
   - `GEMINI_API_KEY`: Your Gemini API key.
3. **Install Bookmarklet**: Open `client/install-bookmarklet.html` in your browser, paste your deployed Web App URL into the input field, and drag the generated button to your bookmarks bar (no manual code editing needed).
   > **Note**: `client/bookmarklet.js` is the unminified source code for reference or manual bookmark configuration.
4. **Happy Shopping**: Browse any NYT Cooking recipe and tap the bookmarklet! 🥑🎉
