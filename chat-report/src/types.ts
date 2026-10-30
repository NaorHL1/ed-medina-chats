export type Platform = 'ios' | 'android';

export type DateOrder = 'dmy' | 'mdy';

export type MessageKind = 'text' | 'media' | 'audio' | 'deleted' | 'system';

/**
 * One message from the export. `ts` is wall-clock time expressed as UTC epoch
 * milliseconds, so day arithmetic never depends on the machine's timezone or
 * DST. `id` is stable for a given input and is what every report cites.
 */
export interface Message {
  id: string;
  ts: number;
  sender: string | null;
  text: string;
  kind: MessageKind;
  edited: boolean;
  line: number;
}

export interface ParseResult {
  platform: Platform;
  dateOrder: DateOrder;
  messages: Message[];
  droppedLines: number;
  warnings: string[];
}
