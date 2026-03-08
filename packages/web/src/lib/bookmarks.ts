import { safeJsonParse } from './utils';

const STORAGE_KEY = 'lala_bookmarks';
const MAX_BOOKMARKS = 50;

export interface Bookmark {
    roomId: string;
    name: string;
    hasPassword?: boolean;
}

export function getBookmarks(): Bookmark[] {
    return safeJsonParse<Bookmark[]>(localStorage.getItem(STORAGE_KEY), []);
}

export function addBookmark(bookmark: Bookmark): void {
    const bookmarks = getBookmarks().filter(b => b.roomId !== bookmark.roomId);
    bookmarks.unshift(bookmark);
    if (bookmarks.length > MAX_BOOKMARKS) bookmarks.length = MAX_BOOKMARKS;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
}

export function removeBookmark(roomId: string): void {
    const bookmarks = getBookmarks().filter(b => b.roomId !== roomId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
}

export function isBookmarked(roomId: string): boolean {
    return getBookmarks().some(b => b.roomId === roomId);
}
