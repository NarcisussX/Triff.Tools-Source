import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transformSync } from 'esbuild';

const source = fs.readFileSync(new URL('../../src/pages/hullActivityFilters.ts', import.meta.url), 'utf8');
const { code } = transformSync(source, { loader: 'ts', format: 'esm' });
const { hullSize, hullRoles, matchesHullFilters, meetsLiquidity, liquidityThreshold, parseSelection } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const hull = (group_name, market_group_name = null) => ({ group_name, market_group_name });

test('size selection includes advanced and faction families without selecting other sizes', () => {
    for (const group of ['Cruiser', 'Heavy Assault Cruiser', 'Logistics', 'Strategic Cruiser', 'Flag Cruiser']) assert.equal(hullSize(hull(group)), 'cruiser');
    for (const group of ['Combat Battlecruiser', 'Attack Battlecruiser', 'Command Ship', 'Expedition Command Ship']) assert.equal(hullSize(hull(group)), 'battlecruiser');
    assert.equal(hullSize(hull('Logistics Frigate')), 'frigate');
    assert.equal(hullSize(hull('Command Destroyer')), 'destroyer');
    assert.equal(hullSize(hull('Marauder')), 'battleship');
    assert.equal(hullSize(hull('New unknown class')), 'other');
});

test('miners include ORE frigates, destroyers and command destroyers, without admitting combat variants', () => {
    for (const group of ['Frigate', 'Destroyer', 'Command Destroyer']) {
        assert.ok(hullRoles(hull(group, 'ORE')).includes('miner'));
        assert.ok(!hullRoles(hull(group, 'Caldari')).includes('miner'));
    }
    for (const group of ['Mining Barge', 'Exhumer', 'Expedition Frigate', 'Industrial Command Ship', 'Capital Industrial Ship']) assert.ok(hullRoles(hull(group)).includes('miner'));
    assert.ok(!hullRoles(hull('Expedition Command Ship', 'Sisters of EVE')).includes('miner'));
});

test('industrial, hauling and capital categories overlap as intended', () => {
    assert.deepEqual(hullRoles(hull('Jump Freighter')), ['industrial', 'hauler', 'capital']);
    assert.deepEqual(hullRoles(hull('Capital Industrial Ship')), ['industrial', 'miner', 'capital']);
    assert.deepEqual(hullRoles(hull('Industrial Command Ship')), ['industrial', 'miner']);
    assert.deepEqual(hullRoles(hull('Lancer Dreadnought')), ['capital']);
    assert.deepEqual(hullRoles(hull('Command Carrier')), ['capital']);
});

test('selections combine within sections and intersect between sections; URL round trips', () => {
    const params = new URLSearchParams({ classes: 'Heavy Assault Cruiser,Logistics', sizes: 'cruiser' });
    const classes = parseSelection(new URLSearchParams(params.toString()).get('classes'));
    assert.ok(matchesHullFilters(hull('Logistics'), ['cruiser'], classes, []));
    assert.ok(matchesHullFilters(hull('Heavy Assault Cruiser'), ['cruiser'], classes, []));
    assert.ok(!matchesHullFilters(hull('Logistics Frigate'), ['cruiser'], classes, []));
    assert.ok(!matchesHullFilters(hull('Logistics'), ['cruiser'], classes, ['miner']));
    assert.ok(matchesHullFilters(hull('New class'), [], [], []));
});

test('annual threshold suppresses zero and rare baseline volume even with a large selected-day spike', () => {
    assert.equal(liquidityThreshold(null), '1');
    assert.equal(liquidityThreshold('invalid'), '1');
    assert.ok(!meetsLiquidity(0, '1'));
    assert.ok(!meetsLiquidity(1 / 365, '1'));
    assert.ok(!meetsLiquidity(364 / 365, '1'));
    assert.ok(meetsLiquidity(1, '1'));
    assert.ok(meetsLiquidity(0, '0'));
    assert.ok(!meetsLiquidity(0, 'traded'));
    assert.ok(meetsLiquidity(1 / 365, 'traded'));
    assert.ok(!meetsLiquidity(NaN, '0'));
});
