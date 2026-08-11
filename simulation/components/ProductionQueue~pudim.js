/**
 * PudimMod - ProductionQueue~pudim.js
 *
 * The ProgressTimeout override and waitingAutoqueue/lastNotificationTime
 * SerializableAttributes were removed to fix OOS in multiplayer.
 *
 * Root cause: overriding ProgressTimeout makes modded and unmodded machines
 * execute different code on the same deterministic timer events, causing
 * simulation state divergence. SerializableAttributes additions make the
 * serialized hash differ between machines.
 *
 * The base-game autoqueue behavior (disables when resources run out) is used
 * instead. Re-enabling autoqueue when resources recover can be done from the
 * GUI side via standard autoqueue network commands (OOS-safe).
 */
