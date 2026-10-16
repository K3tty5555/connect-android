import * as SecureStore from 'expo-secure-store';
import type { SecureStorePort } from '../net/deviceIdentity';
import {
  parseMobileResumeTarget,
  type MobileResumeTarget,
} from './resumeTarget';
export {
  describeMobileResumeTarget,
  parseMobileResumeTarget,
  resolveMobileRouteRevalidation,
  resolveMobileResumeTarget,
  shouldApplyMobileResumeTarget,
  type MobileResumeTarget,
} from './resumeTarget';

const RESUME_KEY = 'connect.mobile.resume.v1';
export class MobileResumeStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly secureStore: SecureStorePort = SecureStore) {}

  async load(): Promise<MobileResumeTarget | null> {
    const raw = await this.secureStore.getItemAsync(RESUME_KEY);
    if (raw === null) return null;
    try {
      const parsed = parseMobileResumeTarget(JSON.parse(raw) as unknown);
      if (parsed !== null) return parsed;
    } catch {
      // Invalid state is removed below and never used for routing.
    }
    await this.secureStore.deleteItemAsync(RESUME_KEY).catch(() => {});
    return null;
  }

  save(target: MobileResumeTarget): Promise<void> {
    const valid = parseMobileResumeTarget(target);
    if (valid === null) return Promise.reject(new Error('invalid mobile resume target'));
    const result = this.queue.then(() => (
      this.secureStore.setItemAsync(RESUME_KEY, JSON.stringify(valid))
    ));
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  clear(): Promise<void> {
    const result = this.queue.then(() => this.secureStore.deleteItemAsync(RESUME_KEY));
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
