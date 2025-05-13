export interface GitHubConfig {
    owner: string;
    repo: string;
    branch: string;
    connectionArn: string;
}
export interface RegionConfig {
    pipelineRegion: string;
    appRegion: string;
    accountId: string;
}
export declare const githubConfig: GitHubConfig;
export declare const regionConfig: RegionConfig;
