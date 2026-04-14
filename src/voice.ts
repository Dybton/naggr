/**
 * Voice message transcription.
 * Downloads a Telegram voice file, sends it to OpenAI's Whisper API,
 * and returns the transcribed text.
 */

import OpenAI from "openai";
import { writeFileSync, unlinkSync, createReadStream } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let openai: OpenAI | null = null;

/** Returns the OpenAI client, creating it on first use (after dotenv has loaded). */
const getClient = (): OpenAI => {
  if (!openai) openai = new OpenAI();
  return openai;
};

/** Downloads a voice file from a URL, transcribes it with Whisper (Danish), and returns the text. Cleans up the temp file afterwards. */
export const transcribeVoice = async (fileUrl: string): Promise<string> => {
  const tmpPath = join(tmpdir(), `naggr-voice-${Date.now()}.ogg`);

  try {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to download voice: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(tmpPath, buffer);

    const transcription = await getClient().audio.transcriptions.create({
      model: "whisper-1",
      file: createReadStream(tmpPath),
      language: "da",
    });

    return transcription.text;
  } finally {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }
  }
};
