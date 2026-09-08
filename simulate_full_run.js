const fs = require('fs');
const vm = require('vm');

const content = fs.readFileSync('index.html', 'utf8');
const scriptStart = content.indexOf('<script>') + '<script>'.length;
const scriptEnd = content.indexOf('</script>');
const jsCode = content.substring(scriptStart, scriptEnd);

function createMockDom() {
  const elements = new Map();

  function makeElement(tag, id = '') {
    const el = {
      tagName: tag.toUpperCase(),
      id: id,
      style: {},
      children: [],
      parentNode: null,
      _classes: new Set(),
      get className() { return Array.from(this._classes).join(' '); },
      set className(val) {
        this._classes.clear();
        if (val) val.split(/\s+/).forEach(c => c && this._classes.add(c));
      },
      get classList() {
        const self = this;
        return {
          add(...c) { c.forEach(x => self._classes.add(x)); },
          remove(...c) { c.forEach(x => self._classes.delete(x)); },
          contains(c) { return self._classes.has(c); }
        };
      },
      appendChild(child) {
        if (!child) return;
        child.parentNode = this;
        this.children.push(child);
      },
      remove() {
        if (this.parentNode) {
          const idx = this.parentNode.children.indexOf(this);
          if (idx !== -1) this.parentNode.children.splice(idx, 1);
        }
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        const res = [];
        function matchesNode(n) {
          if (!n) return false;
          if (sel.startsWith('#')) return n.id === sel.slice(1);
          if (sel.startsWith('.')) {
            const parts = sel.split('.').filter(Boolean);
            return parts.every(p => {
              if (p.includes(':not(')) {
                const notParts = p.split(':not(');
                const baseClass = notParts[0];
                const notClass = notParts[1].replace(/[\)\.]/g, '');
                return n._classes.has(baseClass) && !n._classes.has(notClass);
              }
              return n._classes.has(p);
            });
          }
          return n.tagName.toLowerCase() === sel.toLowerCase();
        }
        function walk(node) {
          if (!node) return;
          if (matchesNode(node)) res.push(node);
          for (const ch of node.children) walk(ch);
        }
        for (const ch of this.children) walk(ch);
        return res;
      },
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k]; },
      getBoundingClientRect() { return { left: 50, top: 50, width: 48, height: 48 }; },
      scrollIntoView() {},
      _innerHTML: '',
      get innerHTML() { return this._innerHTML; },
      set innerHTML(val) {
        this._innerHTML = val;
        this.children = [];
      },
      get textContent() { return this._textContent || this._innerHTML || ''; },
      set textContent(val) {
        this._textContent = val;
        this._innerHTML = val;
      },
      click() {
        if (this.onclick) {
          this.onclick({ target: this });
        }
      }
    };
    return el;
  }

  const doc = {
    body: makeElement('body', 'body'),
    getElementById(id) {
      if (!elements.has(id)) {
        const el = makeElement('div', id);
        elements.set(id, el);
        doc.body.appendChild(el);
      }
      return elements.get(id);
    },
    createElement(tag) { return makeElement(tag); },
    createElementNS(ns, tag) { return makeElement(tag); },
    querySelector(sel) { return doc.body.querySelector(sel); },
    querySelectorAll(sel) { return doc.body.querySelectorAll(sel); }
  };

  return doc;
}

const mockDoc = createMockDom();
const mockWin = {};
const mockLs = {
  data: {},
  getItem(k) { return this.data[k] || null; },
  setItem(k, v) { this.data[k] = v; },
  removeItem(k) { delete this.data[k]; }
};

const taskQueue = [];
const ctx = {
  window: mockWin,
  document: mockDoc,
  localStorage: mockLs,
  setTimeout: (fn) => {
    taskQueue.push(fn);
    return taskQueue.length;
  },
  clearTimeout: () => {},
  console: console,
  Math: Math
};
vm.createContext(ctx);
vm.runInContext(jsCode, ctx);

const game = mockWin.game;
console.log('=== STARTING FULL RUN AUTO-PILOT SIMULATION (FLOOR 1 TO 15) ===\n');
game.startNewRun();
game.autoPilot.enabled = true;

let stepCount = 0;
const maxSteps = 4000;
let lastFloor = 0;
let lastScreen = '';

let runCount = 1;

while (stepCount < maxSteps) {
  stepCount++;

  const screen = game.activeScreenId;
  if (game.currentFloor !== lastFloor || screen !== lastScreen) {
    if (game.currentFloor !== lastFloor && game.currentFloor > 0) {
      console.log(`\n------------------------------------------------------------`);
      console.log(`>>> [Floor ${game.currentFloor}/15] Screen: ${screen} | HP: ${game.player.hp}/${game.player.maxHp} | Gold: ${game.player.gold} | Deck: ${game.player.deck.length} cards`);
      console.log(`------------------------------------------------------------`);
      lastFloor = game.currentFloor;
    }
    lastScreen = screen;
  }

  // Check victory
  if (game.activeScreenId === 'victory-screen') {
    console.log('\n============================================================');
    console.log('🏆 VICTORY! Floor 15 Summit Boss (Void Sovereign) DEFEATED!');
    console.log('============================================================');
    console.log(`Victory achieved on Run #${runCount}`);
    console.log(`Total Auto-Pilot steps: ${stepCount}`);
    console.log(`Final Player HP: ${game.player.hp}/${game.player.maxHp}`);
    console.log(`Final Deck size: ${game.player.deck.length}`);
    console.log(`Final Deck cards: ${game.player.deck.map(c => c.name + (c.upgraded ? '+' : '')).join(', ')}`);
    console.log(`Final Relics (${game.player.relics.length}): ${game.player.relics.join(', ')}`);
    console.log(`Unlocked Max Ascension: ${game.meta.maxAscension}`);
    console.log('============================================================\n');
    process.exit(0);
  }

  if (game.activeScreenId === 'gameover-screen') {
    runCount++;
    console.log(`\n💀 Run ended on Floor ${game.currentFloor}! Starting Run #${runCount}...`);
    game.autoPilot.executeCurrentScreenAction();
    while (taskQueue.length > 0) {
      const fn = taskQueue.shift();
      try { fn(); } catch (e) {}
    }
    continue;
  }

  // Process auto-pilot action
  game.autoPilot.executeCurrentScreenAction();

  // Drain timer microtasks
  let drainLoops = 0;
  while (taskQueue.length > 0 && drainLoops < 100) {
    drainLoops++;
    const fn = taskQueue.shift();
    try { fn(); } catch (e) {}
  }
}

console.error(`Reached max steps limit (${maxSteps}) without reaching victory screen.`);
process.exit(1);
