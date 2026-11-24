// Shared game state and DOM helpers used by every other script.

let LEVEL, W, H, BUDGET, N, ENTRY, EXIT, ROCKS;
const idx = (x, y) => y * W + x;

let walls = new Set();
let dist;
let myBest = 0, optBest = 0, exactBest = 0;
let assisted = false;         // walls came from a solver, so edits don't count as "your best"
let mode = 'edit';            // 'edit' | 'opt' | 'exact'
let flash = null;             // {cell, until}
let sa = null;

const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);

function say(t) { $('msg').textContent = t; }
