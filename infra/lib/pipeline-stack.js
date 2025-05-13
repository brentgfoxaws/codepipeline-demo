"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const ecr = __importStar(require("aws-cdk-lib/aws-ecr"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const codebuild = __importStar(require("aws-cdk-lib/aws-codebuild"));
const codepipeline = __importStar(require("aws-cdk-lib/aws-codepipeline"));
const codepipeline_actions = __importStar(require("aws-cdk-lib/aws-codepipeline-actions"));
const config_1 = require("./config");
class PipelineStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Add a Name tag to all resources in this stack
        cdk.Tags.of(this).add('Name', 'codepipeline-demo');
        // ECR Repository
        const ecrRepo = new ecr.Repository(this, 'CodepipelineDemoEcrRepo', {
            repositoryName: 'codepipeline-demo',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            emptyOnDelete: true,
        });
        // We'll use a custom resource to set up cross-region replication
        // This is an alternative approach since direct replication configuration might not be available in your CDK version
        // Instead of using ECR replication, we'll push to both regions from CodeBuild
        // CodeBuild Project
        const buildProject = new codebuild.PipelineProject(this, 'CodepipelineDemoBuildProject', {
            projectName: 'codepipeline-demo-build',
            environment: {
                buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_3,
                privileged: true, // Required for Docker builds
            },
            environmentVariables: {
                REPOSITORY_URI: {
                    value: ecrRepo.repositoryUri,
                },
                CONTAINER_NAME: {
                    value: 'codepipeline-demo',
                },
            },
            buildSpec: codebuild.BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    pre_build: {
                        commands: [
                            'echo Logging in to Amazon ECR...',
                            'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $REPOSITORY_URI',
                            'COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)',
                            'IMAGE_TAG=${COMMIT_HASH:=latest}',
                        ],
                    },
                    build: {
                        commands: [
                            'echo Building the Docker image...',
                            'cd app',
                            'docker build -t $REPOSITORY_URI:latest .',
                            'docker tag $REPOSITORY_URI:latest $REPOSITORY_URI:$IMAGE_TAG',
                        ],
                    },
                    post_build: {
                        commands: [
                            'echo Pushing the Docker image to pipeline region...',
                            'docker push $REPOSITORY_URI:latest',
                            'docker push $REPOSITORY_URI:$IMAGE_TAG',
                            'echo Creating repository in app region if it does not exist...',
                            'aws ecr create-repository --repository-name codepipeline-demo --region ' + config_1.regionConfig.appRegion + ' || true',
                            'echo Pushing the Docker image to app region...',
                            'APP_REPO=$(echo $REPOSITORY_URI | sed "s/' + config_1.regionConfig.pipelineRegion + '/' + config_1.regionConfig.appRegion + '/g")',
                            'aws ecr get-login-password --region ' + config_1.regionConfig.appRegion + ' | docker login --username AWS --password-stdin $APP_REPO',
                            'docker tag $REPOSITORY_URI:latest $APP_REPO:latest',
                            'docker tag $REPOSITORY_URI:$IMAGE_TAG $APP_REPO:$IMAGE_TAG',
                            'docker push $APP_REPO:latest',
                            'docker push $APP_REPO:$IMAGE_TAG',
                            'echo Updating ECS service in app region...',
                            'aws ecs update-service --cluster codepipeline-demo-cluster --service codepipeline-demo-service --force-new-deployment --region ' + config_1.regionConfig.appRegion,
                        ],
                    },
                },
            }),
        });
        // Grant permissions to CodeBuild
        ecrRepo.grantPullPush(buildProject.role);
        buildProject.addToRolePolicy(new iam.PolicyStatement({
            actions: ['ecs:UpdateService'],
            resources: ['*'],
        }));
        // Add cross-region permissions for ECR and ECS
        buildProject.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'ecr:GetAuthorizationToken'
            ],
            resources: ['*'],
        }));
        // Add comprehensive ECR permissions for the app region
        buildProject.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'ecr:BatchCheckLayerAvailability',
                'ecr:BatchGetImage',
                'ecr:CompleteLayerUpload',
                'ecr:CreateRepository',
                'ecr:DescribeImages',
                'ecr:DescribeRepositories',
                'ecr:GetDownloadUrlForLayer',
                'ecr:InitiateLayerUpload',
                'ecr:PutImage',
                'ecr:PutLifecyclePolicy',
                'ecr:UploadLayerPart'
            ],
            resources: ['arn:aws:ecr:' + config_1.regionConfig.appRegion + ':' + config_1.regionConfig.accountId + ':repository/*'],
        }));
        // CodePipeline
        const sourceOutput = new codepipeline.Artifact();
        const buildOutput = new codepipeline.Artifact();
        const pipeline = new codepipeline.Pipeline(this, 'CodepipelineDemoPipeline', {
            pipelineName: 'codepipeline-demo-pipeline',
            restartExecutionOnUpdate: true,
        });
        // Source Stage
        pipeline.addStage({
            stageName: 'Source',
            actions: [
                new codepipeline_actions.CodeStarConnectionsSourceAction({
                    actionName: 'GitHub_Source',
                    owner: config_1.githubConfig.owner,
                    repo: config_1.githubConfig.repo,
                    branch: config_1.githubConfig.branch,
                    connectionArn: config_1.githubConfig.connectionArn,
                    output: sourceOutput,
                }),
            ],
        });
        // Build Stage
        pipeline.addStage({
            stageName: 'Build',
            actions: [
                new codepipeline_actions.CodeBuildAction({
                    actionName: 'BuildAndPush',
                    project: buildProject,
                    input: sourceOutput,
                    outputs: [buildOutput],
                }),
            ],
        });
        // Outputs
        new cdk.CfnOutput(this, 'EcrRepositoryUri', {
            value: ecrRepo.repositoryUri,
            description: 'URI of the ECR Repository',
        });
    }
}
exports.PipelineStack = PipelineStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGlwZWxpbmUtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJwaXBlbGluZS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUVuQyx5REFBMkM7QUFDM0MseURBQTJDO0FBQzNDLHFFQUF1RDtBQUN2RCwyRUFBNkQ7QUFDN0QsMkZBQTZFO0FBQzdFLHFDQUFzRDtBQUV0RCxNQUFhLGFBQWMsU0FBUSxHQUFHLENBQUMsS0FBSztJQUMxQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLGdEQUFnRDtRQUNoRCxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLG1CQUFtQixDQUFDLENBQUM7UUFFbkQsaUJBQWlCO1FBQ2pCLE1BQU0sT0FBTyxHQUFHLElBQUksR0FBRyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUseUJBQXlCLEVBQUU7WUFDbEUsY0FBYyxFQUFFLG1CQUFtQjtZQUNuQyxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1lBQ3hDLGFBQWEsRUFBRSxJQUFJO1NBQ3BCLENBQUMsQ0FBQztRQUVILGlFQUFpRTtRQUNqRSxvSEFBb0g7UUFFcEgsOEVBQThFO1FBRTlFLG9CQUFvQjtRQUNwQixNQUFNLFlBQVksR0FBRyxJQUFJLFNBQVMsQ0FBQyxlQUFlLENBQUMsSUFBSSxFQUFFLDhCQUE4QixFQUFFO1lBQ3ZGLFdBQVcsRUFBRSx5QkFBeUI7WUFDdEMsV0FBVyxFQUFFO2dCQUNYLFVBQVUsRUFBRSxTQUFTLENBQUMsZUFBZSxDQUFDLGdCQUFnQjtnQkFDdEQsVUFBVSxFQUFFLElBQUksRUFBRSw2QkFBNkI7YUFDaEQ7WUFDRCxvQkFBb0IsRUFBRTtnQkFDcEIs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LEVBQUU7Z0JBQ1AsSUFBSSxvQkFBb0IsQ0FBQywrQkFBK0IsQ0FBQztvQkFDdkQsVUFBVSxFQUFFLGVBQWU7b0JBQzNCLEtBQUssRUFBRSxxQkFBWSxDQUFDLEtBQUs7b0JBQ3pCLElBQUksRUFBRSxxQkFBWSxDQUFDLElBQUk7b0JBQ3ZCLE1BQU0sRUFBRSxxQkFBWSxDQUFDLE1BQU07b0JBQzNCLGFBQWEsRUFBRSxxQkFBWSxDQUFDLGFBQWE7b0JBQ3pDLE1BQU0sRUFBRSxZQUFZO2lCQUNyQixDQUFDO2FBQ0g7U0FDRixDQUFDLENBQUM7UUFFSCxjQUFjO1FBQ2QsUUFBUSxDQUFDLFFBQVEsQ0FBQztZQUNoQixTQUFTLEVBQUUsT0FBTztZQUNsQixPQUFPLEVBQUU7Z0JBQ1AsSUFBSSxvQkFBb0IsQ0FBQyxlQUFlLENBQUM7b0JBQ3ZDLFVBQVUsRUFBRSxjQUFjO29CQUMxQixPQUFPLEVBQUUsWUFBWTtvQkFDckIsS0FBSyxFQUFFLFlBQVk7b0JBQ25CLE9BQU8sRUFBRSxDQUFDLFdBQVcsQ0FBQztpQkFDdkIsQ0FBQzthQUNIO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsVUFBVTtRQUNWLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDMUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxhQUFhO1lBQzVCLFdBQVcsRUFBRSwyQkFBMkI7U0FDekMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBdkpELHNDQXVKQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIGVjciBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNyJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGNvZGVidWlsZCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29kZWJ1aWxkJztcbmltcG9ydCAqIGFzIGNvZGVwaXBlbGluZSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29kZXBpcGVsaW5lJztcbmltcG9ydCAqIGFzIGNvZGVwaXBlbGluZV9hY3Rpb25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2RlcGlwZWxpbmUtYWN0aW9ucyc7XG5pbXBvcnQgeyBnaXRodWJDb25maWcsIHJlZ2lvbkNvbmZpZyB9IGZyb20gJy4vY29uZmlnJztcblxuZXhwb3J0IGNsYXNzIFBpcGVsaW5lU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG4gICAgXG4gICAgLy8gQWRkIGEgTmFtZSB0YWcgdG8gYWxsIHJlc291cmNlcyBpbiB0aGlzIHN0YWNrXG4gICAgY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdOYW1lJywgJ2NvZGVwaXBlbGluZS1kZW1vJyk7XG5cbiAgICAvLyBFQ1IgUmVwb3NpdG9yeVxuICAgIGNvbnN0IGVjclJlcG8gPSBuZXcgZWNyLlJlcG9zaXRvcnkodGhpcywgJ0NvZGVwaXBlbGluZURlbW9FY3JSZXBvJywge1xuICAgICAgcmVwb3NpdG9yeU5hbWU6ICdjb2RlcGlwZWxpbmUtZGVtbycsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgZW1wdHlPbkRlbGV0ZTogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIFdlJ2xsIHVzZSBhIGN1c3RvbSByZXNvdXJjZSB0byBzZXQgdXAgY3Jvc3MtcmVnaW9uIHJlcGxpY2F0aW9uXG4gICAgLy8gVGhpcyBpcyBhbiBhbHRlcm5hdGl2ZSBhcHByb2FjaCBzaW5jZSBkaXJlY3QgcmVwbGljYXRpb24gY29uZmlndXJhdGlvbiBtaWdodCBub3QgYmUgYXZhaWxhYmxlIGluIHlvdXIgQ0RLIHZlcnNpb25cblxuICAgIC8vIEluc3RlYWQgb2YgdXNpbmcgRUNSIHJlcGxpY2F0aW9uLCB3ZSdsbCBwdXNoIHRvIGJvdGggcmVnaW9ucyBmcm9tIENvZGVCdWlsZFxuXG4gICAgLy8gQ29kZUJ1aWxkIFByb2plY3RcbiAgICBjb25zdCBidWlsZFByb2plY3QgPSBuZXcgY29kZWJ1aWxkLlBpcGVsaW5lUHJvamVjdCh0aGlzLCAnQ29kZXBpcGVsaW5lRGVtb0J1aWxkUHJvamVjdCcsIHtcbiAgICAgIHByb2plY3ROYW1lOiAnY29kZXBpcGVsaW5lLWRlbW8tYnVpbGQnLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgYnVpbGRJbWFnZTogY29kZWJ1aWxkLkxpbnV4QnVpbGRJbWFnZS5BTUFaT05fTElOVVhfMl8zLFxuICAgICAgICBwcml2aWxlZ2VkOiB0cnVlLCAvLyBSZXF1aXJlZCBmb3IgRG9ja2VyIGJ1aWxkc1xuICAgICAgfSxcbiAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgIFJFUE9TSVRPUllfVVJJOiB7XG4gICAgICAgICAgdmFsdWU6IGVjclJlcG8ucmVwb3NpdG9yeVVyaSxcbiAgICAgICAgfSxcbiAgICAgICAgQ09OVEFJTkVSX05BTUU6IHtcbiAgICAgICAgICB2YWx1ZTogJ2NvZGVwaXBlbGluZS1kZW1vJyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBidWlsZFNwZWM6IGNvZGVidWlsZC5CdWlsZFNwZWMuZnJvbU9iamVjdCh7XG4gICAgICAgIHZlcnNpb246ICcwLjInLFxuICAgICAgICBwaGFzZXM6IHtcbiAgICAgICAgICBwcmVfYnVpbGQ6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAgICdlY2hvIExvZ2dpbmcgaW4gdG8gQW1hem9uIEVDUi4uLicsXG4gICAgICAgICAgICAgICdhd3MgZWNyIGdldC1sb2dpbi1wYXNzd29yZCAtLXJlZ2lvbiAkQVdTX0RFRkFVTFRfUkVHSU9OIHwgZG9ja2VyIGxvZ2luIC0tdXNlcm5hbWUgQVdTIC0tcGFzc3dvcmQtc3RkaW4gJFJFUE9TSVRPUllfVVJJJyxcbiAgICAgICAgICAgICAgJ0NPTU1JVF9IQVNIPSQoZWNobyAkQ09ERUJVSUxEX1JFU09MVkVEX1NPVVJDRV9WRVJTSU9OIHwgY3V0IC1jIDEtNyknLFxuICAgICAgICAgICAgICAnSU1BR0VfVEFHPSR7Q09NTUlUX0hBU0g6PWxhdGVzdH0nLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnZWNobyBCdWlsZGluZyB0aGUgRG9ja2VyIGltYWdlLi4uJyxcbiAgICAgICAgICAgICAgJ2NkIGFwcCcsXG4gICAgICAgICAgICAgICdkb2NrZXIgYnVpbGQgLXQgJFJFUE9TSVRPUllfVVJJOmxhdGVzdCAuJyxcbiAgICAgICAgICAgICAgJ2RvY2tlciB0YWcgJFJFUE9TSVRPUllfVVJJOmxhdGVzdCAkUkVQT1NJVE9SWV9VUkk6JElNQUdFX1RBRycsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgcG9zdF9idWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ2VjaG8gUHVzaGluZyB0aGUgRG9ja2VyIGltYWdlIHRvIHBpcGVsaW5lIHJlZ2lvbi4uLicsXG4gICAgICAgICAgICAgICdkb2NrZXIgcHVzaCAkUkVQT1NJVE9SWV9VUkk6bGF0ZXN0JyxcbiAgICAgICAgICAgICAgJ2RvY2tlciBwdXNoICRSRVBPU0lUT1JZX1VSSTokSU1BR0VfVEFHJyxcbiAgICAgICAgICAgICAgJ2VjaG8gQ3JlYXRpbmcgcmVwb3NpdG9yeSBpbiBhcHAgcmVnaW9uIGlmIGl0IGRvZXMgbm90IGV4aXN0Li4uJyxcbiAgICAgICAgICAgICAgJ2F3cyBlY3IgY3JlYXRlLXJlcG9zaXRvcnkgLS1yZXBvc2l0b3J5LW5hbWUgY29kZXBpcGVsaW5lLWRlbW8gLS1yZWdpb24gJyArIHJlZ2lvbkNvbmZpZy5hcHBSZWdpb24gKyAnIHx8IHRydWUnLFxuICAgICAgICAgICAgICAnZWNobyBQdXNoaW5nIHRoZSBEb2NrZXIgaW1hZ2UgdG8gYXBwIHJlZ2lvbi4uLicsXG4gICAgICAgICAgICAgICdBUFBfUkVQTz0kKGVjaG8gJFJFUE9TSVRPUllfVVJJIHwgc2VkIFwicy8nICsgcmVnaW9uQ29uZmlnLnBpcGVsaW5lUmVnaW9uICsgJy8nICsgcmVnaW9uQ29uZmlnLmFwcFJlZ2lvbiArICcvZ1wiKScsXG4gICAgICAgICAgICAgICdhd3MgZWNyIGdldC1sb2dpbi1wYXNzd29yZCAtLXJlZ2lvbiAnICsgcmVnaW9uQ29uZmlnLmFwcFJlZ2lvbiArICcgfCBkb2NrZXIgbG9naW4gLS11c2VybmFtZSBBV1MgLS1wYXNzd29yZC1zdGRpbiAkQVBQX1JFUE8nLFxuICAgICAgICAgICAgICAnZG9ja2VyIHRhZyAkUkVQT1NJVE9SWV9VUkk6bGF0ZXN0ICRBUFBfUkVQTzpsYXRlc3QnLFxuICAgICAgICAgICAgICAnZG9ja2VyIHRhZyAkUkVQT1NJVE9SWV9VUkk6JElNQUdFX1RBRyAkQVBQX1JFUE86JElNQUdFX1RBRycsXG4gICAgICAgICAgICAgICdkb2NrZXIgcHVzaCAkQVBQX1JFUE86bGF0ZXN0JyxcbiAgICAgICAgICAgICAgJ2RvY2tlciBwdXNoICRBUFBfUkVQTzokSU1BR0VfVEFHJyxcbiAgICAgICAgICAgICAgJ2VjaG8gVXBkYXRpbmcgRUNTIHNlcnZpY2UgaW4gYXBwIHJlZ2lvbi4uLicsXG4gICAgICAgICAgICAgICdhd3MgZWNzIHVwZGF0ZS1zZXJ2aWNlIC0tY2x1c3RlciBjb2RlcGlwZWxpbmUtZGVtby1jbHVzdGVyIC0tc2VydmljZSBjb2RlcGlwZWxpbmUtZGVtby1zZXJ2aWNlIC0tZm9yY2UtbmV3LWRlcGxveW1lbnQgLS1yZWdpb24gJyArIHJlZ2lvbkNvbmZpZy5hcHBSZWdpb24sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIHRvIENvZGVCdWlsZFxuICAgIGVjclJlcG8uZ3JhbnRQdWxsUHVzaChidWlsZFByb2plY3Qucm9sZSEpO1xuICAgIGJ1aWxkUHJvamVjdC5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydlY3M6VXBkYXRlU2VydmljZSddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBBZGQgY3Jvc3MtcmVnaW9uIHBlcm1pc3Npb25zIGZvciBFQ1IgYW5kIEVDU1xuICAgIGJ1aWxkUHJvamVjdC5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnZWNyOkdldEF1dGhvcml6YXRpb25Ub2tlbidcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcbiAgICBcbiAgICAvLyBBZGQgY29tcHJlaGVuc2l2ZSBFQ1IgcGVybWlzc2lvbnMgZm9yIHRoZSBhcHAgcmVnaW9uXG4gICAgYnVpbGRQcm9qZWN0LmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdlY3I6QmF0Y2hDaGVja0xheWVyQXZhaWxhYmlsaXR5JyxcbiAgICAgICAgJ2VjcjpCYXRjaEdldEltYWdlJyxcbiAgICAgICAgJ2VjcjpDb21wbGV0ZUxheWVyVXBsb2FkJyxcbiAgICAgICAgJ2VjcjpDcmVhdGVSZXBvc2l0b3J5JyxcbiAgICAgICAgJ2VjcjpEZXNjcmliZUltYWdlcycsXG4gICAgICAgICdlY3I6RGVzY3JpYmVSZXBvc2l0b3JpZXMnLFxuICAgICAgICAnZWNyOkdldERvd25sb2FkVXJsRm9yTGF5ZXInLFxuICAgICAgICAnZWNyOkluaXRpYXRlTGF5ZXJVcGxvYWQnLFxuICAgICAgICAnZWNyOlB1dEltYWdlJyxcbiAgICAgICAgJ2VjcjpQdXRMaWZlY3ljbGVQb2xpY3knLFxuICAgICAgICAnZWNyOlVwbG9hZExheWVyUGFydCdcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnYXJuOmF3czplY3I6JyArIHJlZ2lvbkNvbmZpZy5hcHBSZWdpb24gKyAnOicgKyByZWdpb25Db25maWcuYWNjb3VudElkICsgJzpyZXBvc2l0b3J5LyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBDb2RlUGlwZWxpbmVcbiAgICBjb25zdCBzb3VyY2VPdXRwdXQgPSBuZXcgY29kZXBpcGVsaW5lLkFydGlmYWN0KCk7XG4gICAgY29uc3QgYnVpbGRPdXRwdXQgPSBuZXcgY29kZXBpcGVsaW5lLkFydGlmYWN0KCk7XG5cbiAgICBjb25zdCBwaXBlbGluZSA9IG5ldyBjb2RlcGlwZWxpbmUuUGlwZWxpbmUodGhpcywgJ0NvZGVwaXBlbGluZURlbW9QaXBlbGluZScsIHtcbiAgICAgIHBpcGVsaW5lTmFtZTogJ2NvZGVwaXBlbGluZS1kZW1vLXBpcGVsaW5lJyxcbiAgICAgIHJlc3RhcnRFeGVjdXRpb25PblVwZGF0ZTogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIFNvdXJjZSBTdGFnZVxuICAgIHBpcGVsaW5lLmFkZFN0YWdlKHtcbiAgICAgIHN0YWdlTmFtZTogJ1NvdXJjZScsXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgIG5ldyBjb2RlcGlwZWxpbmVfYWN0aW9ucy5Db2RlU3RhckNvbm5lY3Rpb25zU291cmNlQWN0aW9uKHtcbiAgICAgICAgICBhY3Rpb25OYW1lOiAnR2l0SHViX1NvdXJjZScsXG4gICAgICAgICAgb3duZXI6IGdpdGh1YkNvbmZpZy5vd25lcixcbiAgICAgICAgICByZXBvOiBnaXRodWJDb25maWcucmVwbyxcbiAgICAgICAgICBicmFuY2g6IGdpdGh1YkNvbmZpZy5icmFuY2gsXG4gICAgICAgICAgY29ubmVjdGlvbkFybjogZ2l0aHViQ29uZmlnLmNvbm5lY3Rpb25Bcm4sXG4gICAgICAgICAgb3V0cHV0OiBzb3VyY2VPdXRwdXQsXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIEJ1aWxkIFN0YWdlXG4gICAgcGlwZWxpbmUuYWRkU3RhZ2Uoe1xuICAgICAgc3RhZ2VOYW1lOiAnQnVpbGQnLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICBuZXcgY29kZXBpcGVsaW5lX2FjdGlvbnMuQ29kZUJ1aWxkQWN0aW9uKHtcbiAgICAgICAgICBhY3Rpb25OYW1lOiAnQnVpbGRBbmRQdXNoJyxcbiAgICAgICAgICBwcm9qZWN0OiBidWlsZFByb2plY3QsXG4gICAgICAgICAgaW5wdXQ6IHNvdXJjZU91dHB1dCxcbiAgICAgICAgICBvdXRwdXRzOiBbYnVpbGRPdXRwdXRdLFxuICAgICAgICB9KSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBPdXRwdXRzXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0VjclJlcG9zaXRvcnlVcmknLCB7XG4gICAgICB2YWx1ZTogZWNyUmVwby5yZXBvc2l0b3J5VXJpLFxuICAgICAgZGVzY3JpcHRpb246ICdVUkkgb2YgdGhlIEVDUiBSZXBvc2l0b3J5JyxcbiAgICB9KTtcbiAgfVxufSJdfQ==