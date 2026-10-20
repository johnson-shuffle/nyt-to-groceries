/**
 * NYT Cooking Bookmarklet Extractor
 * Extracts recipe title and ingredients from schema.org/Recipe JSON-LD
 * and POSTs to the Google Apps Script Web App.
 *
 * NOTE: If installing via client/install-bookmarklet.html, you do NOT need to edit this file.
 * If configuring manually, replace YOUR_DEPLOYMENT_ID with your deployed Web App ID.
 */
(function () {
  // Replace with your deployed Apps Script Web App Exec URL:
  const SCRIPT_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec";

  function showToast(message, isError) {
    const existing = document.getElementById("nyt-tasks-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "nyt-tasks-toast";
    toast.style.position = "fixed";
    toast.style.top = "20px";
    toast.style.right = "20px";
    toast.style.zIndex = "999999";
    toast.style.backgroundColor = isError ? "#d93025" : "#188038";
    toast.style.color = "#ffffff";
    toast.style.padding = "14px 20px";
    toast.style.borderRadius = "8px";
    toast.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    toast.style.fontSize = "14px";
    toast.style.boxShadow = "0 4px 12px rgba(0,0,0,0.25)";
    toast.style.maxWidth = "350px";
    toast.style.transition = "opacity 0.3s ease";
    toast.textContent = message;

    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function findRecipeSchema() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        if (data["@type"] === "Recipe") {
          return data;
        }
        if (Array.isArray(data["@graph"])) {
          const recipe = data["@graph"].find(item => item["@type"] === "Recipe");
          if (recipe) return recipe;
        }
      } catch (e) {
        // Continue searching other scripts
      }
    }
    return null;
  }

  const recipe = findRecipeSchema();
  if (!recipe || !recipe.recipeIngredient || recipe.recipeIngredient.length === 0) {
    showToast("Could not find a recipe with ingredients on this page.", true);
    return;
  }

  const title = recipe.name || document.title.replace(" - NYT Cooking", "").trim();
  const ingredients = recipe.recipeIngredient;
  const url = window.location.href;

  showToast(`Adding "${title}" (${ingredients.length} ingredients) to Google Tasks...`, false);

  fetch(SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({
      title: title,
      url: url,
      ingredients: ingredients
    })
  })
  .then(() => {
    showToast(`Added "${title}" with ${ingredients.length} ingredients to Groceries!`, false);
  })
  .catch(err => {
    showToast(`Error sending recipe: ${err.message}`, true);
  });
})();
