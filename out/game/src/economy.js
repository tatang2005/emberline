// economy.js — EMBERLINE money, buy menu data, prices.
// Written fresh in the build session (2026-11-17).
import { WEAPONS } from './weapons.js';

export const REWARDS = {
  kill: 300,
  win: 3250,
  loss: 1900,
  plant: 300,
  defuse: 300,
};

const GRENADE_PRICES = { smoke: 300, flash: 200, he: 300 };
const ARMOR_PRICE = 650;
const ARMOR_MAX = 100;
const START_MONEY = 800;

export function createEconomy() {
  const api = {
    money: START_MONEY,
    armor: 0,
    grenades: { smoke: 1, flash: 1, he: 1 },
    add,
    spend,
    resetRound,
    resetMatch,
    buyWeapon,
    buyGrenade,
    buyArmor,
  };

  function add(n, reason) {
    if (n > 0) api.money += n;
    return api.money;
  }

  function spend(n) {
    if (n <= 0) return true;
    if (api.money < n) return false;
    api.money -= n;
    return true;
  }

  // Money persists across rounds; nothing resets per round.
  function resetRound() {}

  function resetMatch() {
    api.money = START_MONEY;
    api.armor = 0;
    api.grenades.smoke = 1;
    api.grenades.flash = 1;
    api.grenades.he = 1;
  }

  // Money only; main.js gives the weapon to the player on success.
  function buyWeapon(id) {
    const def = WEAPONS[id];
    if (!def) return false;
    return spend(def.price);
  }

  function buyGrenade(type) {
    const price = GRENADE_PRICES[type];
    if (price === undefined) return false;
    if (!spend(price)) return false;
    api.grenades[type]++;
    return true;
  }

  function buyArmor() {
    if (api.armor >= ARMOR_MAX) return false;
    if (!spend(ARMOR_PRICE)) return false;
    api.armor = ARMOR_MAX;
    return true;
  }

  return api;
}
