import type { BotCommand } from '../../../lib/types';

export interface Suggestion extends BotCommand {
    bot: string;
}

export const SUGGESTIONS_ID = 'cp-command-suggestions';
export const suggestionId = (i: number) => `${SUGGESTIONS_ID}-${i}`;

/** Commands of the bots in the room that start with what is typed, while it is one `!word`. */
export function matchCommands(text: string, bots: Iterable<{ name: string; commands: BotCommand[] }>): Suggestion[] {
    if (!/^![^\s]*$/.test(text)) return [];
    const typed = text.toLowerCase();
    return [...bots].flatMap(b => b.commands.filter(c => c.name.startsWith(typed)).map(c => ({ ...c, bot: b.name })));
}
