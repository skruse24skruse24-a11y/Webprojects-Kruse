// Cult IVR — menu tree definition.
// This same tree shape is what drives the real phone menu (see TWILIO-SETUP.md).
// Each node is either a MENU (has `prompt` + `options`) or a LEAF (has `message`).
// `options` maps a pressed digit to the id of the next node.
const TREE = {
  start: {
    prompt:
      "Welcome to the Order of the Open Source. " +
      "Press 1 for gathering times. " +
      "Press 2 for membership. " +
      "Press 3 to hear the sacred text. " +
      "Press 0 to leave an offering.",
    options: { "1": "gatherings", "2": "membership", "3": "sacredText", "0": "offering" }
  },

  gatherings: {
    prompt:
      "Gatherings. " +
      "Press 1 for the weekly meeting. " +
      "Press 2 for the full moon ceremony.",
    options: { "1": "weekly", "2": "fullMoon" }
  },
  weekly: {
    message: "We gather every Thursday at 7 PM in the back room of the library. Bring a candle."
  },
  fullMoon: {
    message: "The full moon ceremony is held at midnight on the hilltop. Robes are provided."
  },

  membership: {
    prompt:
      "Membership. " +
      "Press 1 for how to join. " +
      "Press 2 for membership dues.",
    options: { "1": "join", "2": "dues" }
  },
  join: {
    message: "To join, recite the oath to any current member and complete the trial of the three riddles."
  },
  dues: {
    message: "Dues are one baked good per month, delivered to the altar. Gluten free is accepted."
  },

  sacredText: {
    message: "In the beginning there was the merge conflict, and lo, it was resolved. So it is written."
  },

  offering: {
    message: "Your offering is noted by the elders. Blessings upon your dependency tree."
  }
};

const START_NODE = "start";

const promptEl = document.getElementById("prompt");
const optionsEl = document.getElementById("options");
const pathEl = document.getElementById("path");
const backBtn = document.getElementById("back");
const restartBtn = document.getElementById("restart");

// History of visited node ids, used by the Back button.
let history = [START_NODE];

function currentId() {
  return history[history.length - 1];
}

function render() {
  const node = TREE[currentId()];
  optionsEl.innerHTML = "";

  if (node.message) {
    // Leaf node: show the terminal text.
    promptEl.textContent = node.message;
  } else {
    promptEl.textContent = node.prompt;
    for (const digit of Object.keys(node.options)) {
      const targetId = node.options[digit];
      const target = TREE[targetId];
      const label = target.message
        ? target.message.slice(0, 40) + (target.message.length > 40 ? "..." : "")
        : target.prompt.split(".")[0];

      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Press " + digit + ": " + label;
      btn.addEventListener("click", () => choose(digit));
      li.appendChild(btn);
      optionsEl.appendChild(li);
    }
  }

  pathEl.textContent = "Path: " + history.join(" > ");
  backBtn.disabled = history.length <= 1;
}

function choose(digit) {
  const node = TREE[currentId()];
  if (!node.options || !node.options[digit]) return;
  history.push(node.options[digit]);
  render();
}

function goBack() {
  if (history.length > 1) {
    history.pop();
    render();
  }
}

function restart() {
  history = [START_NODE];
  render();
}

backBtn.addEventListener("click", goBack);
restartBtn.addEventListener("click", restart);

// Let the number keys act like a real phone keypad.
document.addEventListener("keydown", (event) => {
  if (/^[0-9]$/.test(event.key)) choose(event.key);
});

render();
