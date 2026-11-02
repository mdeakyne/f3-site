import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = (route: string) => readFileSync(new URL(`../src/pages/${route}/index.astro`, import.meta.url), 'utf8');
const cotOrder = /Name-o-Rama[\s\S]*Announcements[\s\S]*closing thought[\s\S]*Ball of Man[\s\S]*[Ff]lag photo/;

test('test_cot_order: checklist, First Q flow, and printable weinke follow local order', () => {
  assert.match(source('q-checklist'), cotOrder);
  const firstQ = source('first-q');
  assert.match(firstQ.slice(0, firstQ.indexOf('const counting')), cotOrder);
  assert.match(firstQ.match(/<pre[\s\S]*?<\/pre>/)?.[0] ?? '', cotOrder);
});

test('test_no_countorama: neither guidance page directs a count-off', () => {
  for (const route of ['q-checklist', 'first-q']) {
    assert.doesNotMatch(source(route), /count[ -]?o[ -]?rama|count[ -]?off/i);
  }
});

test('printable weinke hides shared layout chrome and reveals the guide', () => {
  const firstQ = source('first-q');
  assert.match(firstQ, /:global\(body \*\)\s*\{\s*visibility:\s*hidden/);
  assert.match(firstQ, /\.weinke,\s*\.weinke \*\s*\{\s*visibility:\s*visible/);
  assert.match(firstQ, /getElementById\('print-weinke'\)[\s\S]*window\.print\(\)/);
});

test('test_motto: checklist uses local motto terminology', () => {
  const checklist = source('q-checklist');
  assert.match(checklist, /motto/);
  assert.doesNotMatch(checklist, /credo/i);
  assert.match(checklist, /five F3 workout principles/);
});

test('checklist has accessible unsaved checkboxes and all practical sections', () => {
  const checklist = source('q-checklist');
  for (const heading of ['Plan', 'Before the workout', 'Lead', 'Circle of Trust', 'After']) {
    assert.ok(checklist.includes(heading), heading);
  }
  assert.match(checklist, /<label[\s\S]*<input[^>]*type="checkbox"/);
  assert.doesNotMatch(checklist, /<script|localStorage|sessionStorage|location\.(?:href|assign|replace)|http-equiv="refresh"/);
  assert.match(checklist, /not saved/);
  assert.match(checklist, /backblast in Slack/);
});

test('checklist links existing local resources and approved external references', () => {
  const checklist = source('q-checklist');
  for (const route of ['exercises', 'backblasts', 'first-q']) {
    assert.ok(checklist.includes(`href="/${route}/"`), route);
    assert.ok(existsSync(new URL(`../src/pages/${route}/index.astro`, import.meta.url)), route);
  }
  for (const url of ['https://f3nation.com/q101/', 'https://codex.f3nation.com/', 'https://www.twosapp.com/65e7a60c32767582884610ca?s=6593fcf0d359942f76c005d4']) {
    assert.ok(checklist.includes(`href="${url}"`), url);
  }
});
