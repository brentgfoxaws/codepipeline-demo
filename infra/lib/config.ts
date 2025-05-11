export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  connectionArn: string;
}

export const githubConfig: GitHubConfig = {
  owner: 'brentgfoxaws',
  repo: 'codepipeline-demo',
  branch: 'main',
  connectionArn: 'arn:aws:codeconnections:ca-central-1:582828318008:connection/adbb8f63-cfe1-43de-b7c2-05ecf23e21b7',
};