/** The newest release tags, read from git at build time (see `demoReleases` in vite.config.ts). */
declare module 'virtual:lala-releases' {
    const releases: Array<{ version: string; date: string; notes: string }>;
    export default releases;
}
