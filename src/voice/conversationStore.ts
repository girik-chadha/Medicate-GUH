// #medicate
import { Conversation, type ConversationListeners } from './conversation';
import type { ChatMessage } from './claude';
import { buildPersona, buildInitialLine, isPediatric, parentGenderFor } from './patientPersona';
import type { PatientCase } from '../game/types';

let sharedCtx: AudioContext | null = null;

export function ensureAudioContext(): AudioContext {
  if (!sharedCtx) {
    sharedCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (sharedCtx.state === 'suspended') {
    // Best-effort resume. Must be called from a user gesture for this to
    // succeed — callers in the Walk-view panel are wired that way.
    sharedCtx.resume().catch(() => undefined);
  }
  return sharedCtx;
}

/** Cached conversation, keyed by bedIndex. `caseId` is carried alongside so
 *  we can detect when a bed (or the polyclinic sentinel -10) receives a
 *  different patient — in that case the old conversation is disposed and a
 *  fresh one is built for the new persona. Without this, the polyclinic's
 *  single sentinel bedIndex caused new patients to inherit the previous
 *  patient's name, history, and voice. */
interface CachedConversation {
  conv: Conversation;
  caseId: string;
}

const store = new Map<number, CachedConversation>();

/** Peek at an existing conversation without creating one. */
export function getExistingConversation(bedIndex: number): Conversation | null {
  return store.get(bedIndex)?.conv ?? null;
}

export function getOrCreatePatientConversation(
  bedIndex: number,
  patientCase: PatientCase,
  listeners: ConversationListeners
): Conversation {
  const existing = store.get(bedIndex);
  if (existing && existing.caseId === patientCase.id) {
    existing.conv.setListeners(listeners);
    return existing.conv;
  }
  if (existing) {
    // A different patient now occupies this slot — tear down the old
    // conversation so the new persona isn't poisoned by prior history.
    existing.conv.dispose();
    store.delete(bedIndex);
  }
  // The polyclinic uses sentinel bedIndex -10; everything else is ER.
  const setting: 'polyclinic' | 'er' = bedIndex === -10 ? 'polyclinic' : 'er';
  const ctx = ensureAudioContext();
  // Speaker gender mirrors the rule in voiceForPatient (now retired):
  // pediatric → parent's gender, adult → patient's gender.
  const speakerGender: 'M' | 'F' = isPediatric(patientCase)
    ? parentGenderFor(patientCase)
    : patientCase.gender;
  // Pediatric cases are voiced by a parent — approximate a parent's age.
  const speakerAge = isPediatric(patientCase) ? patientCase.age + 30 : patientCase.age;
  const conv = new Conversation(ctx, listeners, {
    systemPrompt: buildPersona(patientCase, setting),
    initialMessage: buildInitialLine(patientCase),
    voiceGender: speakerGender,
    voiceAge: speakerAge,
    caseId: patientCase.id,
    // Persist per-patient history so refreshing the page or walking away
    // and back doesn't wipe the conversation — the patient remembers you.
    storageKey: `conv_history_${patientCase.id}`,
  });
  store.set(bedIndex, { conv, caseId: patientCase.id });
  return conv;
}

/** Last transcript of each disposed conversation, keyed by caseId. The
 *  encounter tears its conversation down before the debrief screen mounts,
 *  so the n8n relay reads the transcript from here. In-memory only. */
const lastTranscripts = new Map<string, ReadonlyArray<ChatMessage>>();

/** Live transcript for `caseId` if its conversation is still open,
 *  otherwise the snapshot taken when it was disposed. */
export function getTranscript(caseId: string): ReadonlyArray<ChatMessage> {
  for (const entry of store.values()) {
    if (entry.caseId === caseId) return entry.conv.getMessages();
  }
  return lastTranscripts.get(caseId) ?? [];
}

export function disposePatientConversation(bedIndex: number) {
  const entry = store.get(bedIndex);
  if (entry) {
    lastTranscripts.set(entry.caseId, [...entry.conv.getMessages()]);
    entry.conv.dispose();
    store.delete(bedIndex);
  }
}

export function clearAllPatientConversations() {
  for (const entry of store.values()) entry.conv.dispose();
  store.clear();
  if (sharedCtx) {
    try { sharedCtx.close(); } catch { /* noop */ }
    sharedCtx = null;
  }
}

/** Wipe ALL persisted patient chat history from localStorage so that on the
 *  next shift, every patient starts a fresh conversation (no "the doctor
 *  asked me this last shift" memory). Pairs with `clearAllPatientConversations`
 *  to fully reset the voice layer between shifts. */
export function clearAllConversationStorage() {
  if (typeof window === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('conv_history_')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // localStorage may be blocked — non-fatal
  }
}
