// Compatibility entry point. New domain modules import their concrete dependencies.
export { DomainError } from './domain-error';
export { makeBoard } from './domain/board-factory';
export { seedEvents } from './domain/demo-events';
export { createEvent } from './domain/event-factory';
export { applyMutation } from './mutations/apply';
