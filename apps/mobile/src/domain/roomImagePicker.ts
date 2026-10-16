import * as Crypto from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha2.js';
import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { launchImageLibraryAsync } from 'expo-image-picker';
import {
  ROOM_IMAGE_MAX_BYTES,
  ROOM_IMAGE_MAX_COUNT,
  ROOM_IMAGE_MESSAGE_MAX_BYTES,
  type PreparedRoomImage,
} from './roomImageTransfer';

export async function digestRoomImage(bytes: Uint8Array): Promise<string> {
  const stable = new Uint8Array(bytes.byteLength);
  stable.set(bytes);
  const digest = sha256(stable);
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function pickRoomImages(
  existing: readonly PreparedRoomImage[],
): Promise<PreparedRoomImage[]> {
  const remaining = ROOM_IMAGE_MAX_COUNT - existing.length;
  if (remaining <= 0) return [];
  const result = await launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    allowsMultipleSelection: true,
    selectionLimit: remaining,
    orderedSelection: true,
    quality: 1,
    exif: false,
    base64: false,
  });
  if (result.canceled) return [];
  const prepared: PreparedRoomImage[] = [];
  let total = existing.reduce((sum, image) => sum + image.bytes.byteLength, 0);
  try {
    for (const asset of result.assets.slice(0, remaining)) {
      const image = await prepareOne(asset.uri, asset.width, asset.height);
      if (total + image.bytes.byteLength > ROOM_IMAGE_MESSAGE_MAX_BYTES) {
        cleanupPreparedRoomImages([image]);
        throw new Error('所选图片总大小超过 12 MiB。');
      }
      total += image.bytes.byteLength;
      prepared.push(image);
    }
    return prepared;
  } catch (error) {
    cleanupPreparedRoomImages(prepared);
    throw error;
  }
}

export async function pickTerminalImage(): Promise<PreparedRoomImage | null> {
  const result = await launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    allowsMultipleSelection: false,
    selectionLimit: 1,
    quality: 1,
    exif: false,
    base64: false,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0]!;
  return prepareOne(asset.uri, asset.width, asset.height);
}

export function cleanupPreparedRoomImages(images: readonly PreparedRoomImage[]): void {
  for (const image of images) {
    try {
      const file = new File(image.uri);
      if (file.exists) file.delete();
    } catch {
      // Manipulator output is app-owned temporary data; cleanup is best effort.
    }
  }
}

async function prepareOne(
  sourceUri: string,
  width: number,
  height: number,
): Promise<PreparedRoomImage> {
  let outputUri: string | null = null;
  try {
    let result = await manipulateAsync(
      sourceUri,
      resizeAction(width, height, 2_048),
      { format: SaveFormat.JPEG, compress: 0.84 },
    );
    outputUri = result.uri;
    let file = new File(result.uri);
    let bytes = await file.bytes();
    if (bytes.byteLength > ROOM_IMAGE_MAX_BYTES) {
      if (file.exists) file.delete();
      result = await manipulateAsync(
        sourceUri,
        resizeAction(width, height, 1_600),
        { format: SaveFormat.JPEG, compress: 0.68 },
      );
      outputUri = result.uri;
      file = new File(result.uri);
      bytes = await file.bytes();
    }
    if (bytes.byteLength < 1 || bytes.byteLength > ROOM_IMAGE_MAX_BYTES) {
      throw new Error('图片压缩后仍超过 5 MB，请换一张图片。');
    }
    return {
      id: `local-${Crypto.randomUUID()}`,
      uri: result.uri,
      mime: 'image/jpeg',
      bytes,
      sha256: await digestRoomImage(bytes),
    };
  } catch (error) {
    if (outputUri !== null) cleanupPreparedRoomImages([{
      id: 'cleanup',
      uri: outputUri,
      mime: 'image/jpeg',
      bytes: new Uint8Array(0),
      sha256: '0'.repeat(64),
    }]);
    throw error;
  }
}

function resizeAction(
  width: number,
  height: number,
  maxDimension: number,
): Array<{ resize: { width?: number; height?: number } }> {
  if (width <= 0 || height <= 0 || Math.max(width, height) <= maxDimension) return [];
  return width >= height
    ? [{ resize: { width: maxDimension } }]
    : [{ resize: { height: maxDimension } }];
}
