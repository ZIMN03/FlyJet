/** Public surface of the simulation package (shared by client and future server). */
export * from './constants';
export * from './types';
export { World, type WorldOptions } from './world';
export { stepWorld } from './step';
export { AIRCRAFT, getAircraftDef, type AircraftDef } from './config/aircraft';
export { MAPS, getMapDef, type MapDef } from './config/maps';
export { GUNS, MISSILES } from './config/weapons';
export { ABILITIES } from './config/abilities';
export { AiBrain, type AiState } from './ai/brain';
export { PERSONALITIES } from './ai/personalities';
export { WaveMode } from './modes/waves';
export type { GameMode, MatchPhase } from './modes/mode';
export { chooseSpawn, spawnAircraft } from './systems/spawn';
export { applyDamage } from './systems/damage';
