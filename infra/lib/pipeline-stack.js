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
                APP_REGION: {
                    value: config_1.regionConfig.appRegion,
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
                            'aws ecr describe-repositories --repository-names codepipeline-demo --region $APP_REGION || aws ecr create-repository --repository-name codepipeline-demo --region $APP_REGION',
                            'echo Pushing the Docker image to app region...',
                            'APP_REPO=$(echo $REPOSITORY_URI | sed "s/' + config_1.regionConfig.pipelineRegion + '/' + config_1.regionConfig.appRegion + '/g")',
                            'aws ecr get-login-password --region $APP_REGION | docker login --username AWS --password-stdin $APP_REPO',
                            'docker tag $REPOSITORY_URI:latest $APP_REPO:latest',
                            'docker tag $REPOSITORY_URI:$IMAGE_TAG $APP_REPO:$IMAGE_TAG',
                            'docker push $APP_REPO:latest',
                            'docker push $APP_REPO:$IMAGE_TAG',
                            'echo Updating ECS service in app region...',
                            'aws ecs update-service --cluster codepipeline-demo-cluster --service codepipeline-demo-service --force-new-deployment --region $APP_REGION',
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
                'ecr:GetAuthorizationToken',
                'ecr:BatchCheckLayerAvailability',
                'ecr:GetDownloadUrlForLayer',
                'ecr:BatchGetImage',
                'ecr:InitiateLayerUpload',
                'ecr:UploadLayerPart',
                'ecr:CompleteLayerUpload',
                'ecr:PutImage'
            ],
            resources: ['*'],
        }));
        // Add permissions to create ECR repository in the app region
        buildProject.addToRolePolicy(new iam.PolicyStatement({
            actions: [
                'ecr:CreateRepository',
                'ecr:PutLifecyclePolicy'
            ],
            resources: ['arn:aws:ecr:' + config_1.regionConfig.appRegion + ':' + config_1.regionConfig.accountId + ':repository/codepipeline-demo'],
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGlwZWxpbmUtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJwaXBlbGluZS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUVuQyx5REFBMkM7QUFDM0MseURBQTJDO0FBQzNDLHFFQUF1RDtBQUN2RCwyRUFBNkQ7QUFDN0QsMkZBQTZFO0FBQzdFLHFDQUFzRDtBQUV0RCxNQUFhLGFBQWMsU0FBUSxHQUFHLENBQUMsS0FBSztJQUMxQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLGdEQUFnRDtRQUNoRCxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsTUFBTSxFQUFFLG1CQUFtQixDQUFDLENBQUM7UUFFbkQsaUJBQWlCO1FBQ2pCLE1BQU0sT0FBTyxHQUFHLElBQUksR0FBRyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUseUJBQXlCLEVBQUU7WUFDbEUsY0FBYyxFQUFFLG1CQUFtQjtZQUNuQyxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1lBQ3hDLGFBQWEsRUFBRSxJQUFJO1NBQ3BCLENBQUMsQ0FBQztRQUVILGlFQUFpRTtRQUNqRSxvSEFBb0g7UUFFcEgsOEVBQThFO1FBRTlFLG9CQUFvQjtRQUNwQixNQUFNLFlBQVksR0FBRyxJQUFJLFNBQVMsQ0FBQyxlQUFlLENBQUMsSUFBSSxFQUFFLDhCQUE4QixFQUFFO1lBQ3ZGLFdBQVcsRUFBRSx5QkFBeUI7WUFDdEMsV0FBVyxFQUFFO2dCQUNYLFVBQVUsRUFBRSxTQUFTLENBQUMsZUFBZSxDQUFDLGdCQUFnQjtnQkFDdEQsVUFBVSxFQUFFLElBQUksRUFBRSw2QkFBNkI7YUFDaEQ7WUFDRCxvQkFBb0IsRUFBRTtnQkFDcEIsY0FBYyxFQUFFO29CQUNkLEtBQUssRUFBRSxPQUFPLENBQUMsYUFBYTtpQkFDN0I7Z0JBQ0QsY0FBYyxFQUFFO29CQUNkLEtBQUssRUFBRSxtQkFBbUI7aUJBQzNCO2dCQUNELFVBQVUsRUFBRTtvQkFDVixLQUFLLEVBQUUscUJBQVksQ0FBQyxTQUFTO2lCQUM5QjthQUNGO1lBQ0QsU0FBUyxFQUFFLFNBQVMsQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDO2dCQUN4QyxPQUFPLEVBQUUsS0FBSztnQkFDZCxNQUFNLEVBQUU7b0JBQ04sU0FBUyxFQUFFO3dCQUNULFFBQVEsRUFBRTs0QkFDUixrQ0FBa0M7NEJBQ2xDLHdIQUF3SDs0QkFDeEgscUVBQXFFOzRCQUNyRSxrQ0FBa0M7eUJBQ25DO3FCQUNGO29CQUNELEtBQUssRUFBRTt3QkFDTCxRQUFRLEVBQUU7NEJBQ1IsbUNBQW1DOzRCQUNuQyxRQUFROzRCQUNSLDBDQUEwQzs0QkFDMUMsOERBQThEO3lCQUMvRDtxQkFDRjtvQkFDRCxVQUFVLEVBQUU7d0JBQ1YsUUFBUSxFQUFFOzRCQUNSLHFEQUFxRDs0QkFDckQsb0NBQW9DOzRCQUNwQyx3Q0FBd0M7NEJBQ3hDLGdFQUFnRTs0QkFDaEUsK0tBQStLOzRCQUMvSyxnREFBZ0Q7NEJBQ2hELDJDQUEyQyxHQUFHLHFCQUFZLENBQUMsY0FBYyxHQUFHLEdBQUcsR0FBRyxxQkFBWSxDQUFDLFNBQVMsR0FBRyxNQUFNOzRCQUNqSCwwR0FBMEc7NEJBQzFHLG9EQUFvRDs0QkFDcEQsNERBQTREOzRCQUM1RCw4QkFBOEI7NEJBQzlCLGtDQUFrQzs0QkFDbEMsNENBQTRDOzRCQUM1Qyw0SUFBNEk7eUJBQzdJO3FCQUNGO2lCQUNGO2FBQ0YsQ0FBQztTQUNILENBQUMsQ0FBQztRQUVILGlDQUFpQztRQUNqQyxPQUFPLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxJQUFLLENBQUMsQ0FBQztRQUMxQyxZQUFZLENBQUMsZUFBZSxDQUFDLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUNuRCxPQUFPLEVBQUUsQ0FBQyxtQkFBbUIsQ0FBQztZQUM5QixTQUFTLEVBQUUsQ0FBQyxHQUFHLENBQUM7U0FDakIsQ0FBQyxDQUFDLENBQUM7UUFFSiwrQ0FBK0M7UUFDL0MsWUFBWSxDQUFDLGVBQWUsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDbkQsT0FBTyxFQUFFO2dCQUNQLDJCQUEyQjtnQkFDM0IsaUNBQWlDO2dCQUNqQyw0QkFBNEI7Z0JBQzVCLG1CQUFtQjtnQkFDbkIseUJBQXlCO2dCQUN6QixxQkFBcUI7Z0JBQ3JCLHlCQUF5QjtnQkFDekIsY0FBYzthQUNmO1lBQ0QsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDO1NBQ2pCLENBQUMsQ0FBQyxDQUFDO1FBRUosNkRBQTZEO1FBQzdELFlBQVksQ0FBQyxlQUFlLENBQUMsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO1lBQ25ELE9BQU8sRUFBRTtnQkFDUCxzQkFBc0I7Z0JBQ3RCLHdCQUF3QjthQUN6QjtZQUNELFNBQVMsRUFBRSxDQUFDLGNBQWMsR0FBRyxxQkFBWSxDQUFDLFNBQVMsR0FBRyxHQUFHLEdBQUcscUJBQVksQ0FBQyxTQUFTLEdBQUcsK0JBQStCLENBQUM7U0FDdEgsQ0FBQyxDQUFDLENBQUM7UUFFSixlQUFlO1FBQ2YsTUFBTSxZQUFZLEdBQUcsSUFBSSxZQUFZLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDakQsTUFBTSxXQUFXLEdBQUcsSUFBSSxZQUFZLENBQUMsUUFBUSxFQUFFLENBQUM7UUFFaEQsTUFBTSxRQUFRLEdBQUcsSUFBSSxZQUFZLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSwwQkFBMEIsRUFBRTtZQUMzRSxZQUFZLEVBQUUsNEJBQTRCO1lBQzFDLHdCQUF3QixFQUFFLElBQUk7U0FDL0IsQ0FBQyxDQUFDO1FBRUgsZUFBZTtRQUNmLFFBQVEsQ0FBQyxRQUFRLENBQUM7WUFDaEIsU0FBUyxFQUFFLFFBQVE7WUFDbkIsT0FBTyxFQUFFO2dCQUNQLElBQUksb0JBQW9CLENBQUMsK0JBQStCLENBQUM7b0JBQ3ZELFVBQVUsRUFBRSxlQUFlO29CQUMzQixLQUFLLEVBQUUscUJBQVksQ0FBQyxLQUFLO29CQUN6QixJQUFJLEVBQUUscUJBQVksQ0FBQyxJQUFJO29CQUN2QixNQUFNLEVBQUUscUJBQVksQ0FBQyxNQUFNO29CQUMzQixhQUFhLEVBQUUscUJBQVksQ0FBQyxhQUFhO29CQUN6QyxNQUFNLEVBQUUsWUFBWTtpQkFDckIsQ0FBQzthQUNIO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsY0FBYztRQUNkLFFBQVEsQ0FBQyxRQUFRLENBQUM7WUFDaEIsU0FBUyxFQUFFLE9BQU87WUFDbEIsT0FBTyxFQUFFO2dCQUNQLElBQUksb0JBQW9CLENBQUMsZUFBZSxDQUFDO29CQUN2QyxVQUFVLEVBQUUsY0FBYztvQkFDMUIsT0FBTyxFQUFFLFlBQVk7b0JBQ3JCLEtBQUssRUFBRSxZQUFZO29CQUNuQixPQUFPLEVBQUUsQ0FBQyxXQUFXLENBQUM7aUJBQ3ZCLENBQUM7YUFDSDtTQUNGLENBQUMsQ0FBQztRQUVILFVBQVU7UUFDVixJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzFDLEtBQUssRUFBRSxPQUFPLENBQUMsYUFBYTtZQUM1QixXQUFXLEVBQUUsMkJBQTJCO1NBQ3pDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXhKRCxzQ0F3SkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBlY3IgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcic7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBjb2RlYnVpbGQgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVidWlsZCc7XG5pbXBvcnQgKiBhcyBjb2RlcGlwZWxpbmUgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVwaXBlbGluZSc7XG5pbXBvcnQgKiBhcyBjb2RlcGlwZWxpbmVfYWN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29kZXBpcGVsaW5lLWFjdGlvbnMnO1xuaW1wb3J0IHsgZ2l0aHViQ29uZmlnLCByZWdpb25Db25maWcgfSBmcm9tICcuL2NvbmZpZyc7XG5cbmV4cG9ydCBjbGFzcyBQaXBlbGluZVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuICAgIFxuICAgIC8vIEFkZCBhIE5hbWUgdGFnIHRvIGFsbCByZXNvdXJjZXMgaW4gdGhpcyBzdGFja1xuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnTmFtZScsICdjb2RlcGlwZWxpbmUtZGVtbycpO1xuXG4gICAgLy8gRUNSIFJlcG9zaXRvcnlcbiAgICBjb25zdCBlY3JSZXBvID0gbmV3IGVjci5SZXBvc2l0b3J5KHRoaXMsICdDb2RlcGlwZWxpbmVEZW1vRWNyUmVwbycsIHtcbiAgICAgIHJlcG9zaXRvcnlOYW1lOiAnY29kZXBpcGVsaW5lLWRlbW8nLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGVtcHR5T25EZWxldGU6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyBXZSdsbCB1c2UgYSBjdXN0b20gcmVzb3VyY2UgdG8gc2V0IHVwIGNyb3NzLXJlZ2lvbiByZXBsaWNhdGlvblxuICAgIC8vIFRoaXMgaXMgYW4gYWx0ZXJuYXRpdmUgYXBwcm9hY2ggc2luY2UgZGlyZWN0IHJlcGxpY2F0aW9uIGNvbmZpZ3VyYXRpb24gbWlnaHQgbm90IGJlIGF2YWlsYWJsZSBpbiB5b3VyIENESyB2ZXJzaW9uXG5cbiAgICAvLyBJbnN0ZWFkIG9mIHVzaW5nIEVDUiByZXBsaWNhdGlvbiwgd2UnbGwgcHVzaCB0byBib3RoIHJlZ2lvbnMgZnJvbSBDb2RlQnVpbGRcblxuICAgIC8vIENvZGVCdWlsZCBQcm9qZWN0XG4gICAgY29uc3QgYnVpbGRQcm9qZWN0ID0gbmV3IGNvZGVidWlsZC5QaXBlbGluZVByb2plY3QodGhpcywgJ0NvZGVwaXBlbGluZURlbW9CdWlsZFByb2plY3QnLCB7XG4gICAgICBwcm9qZWN0TmFtZTogJ2NvZGVwaXBlbGluZS1kZW1vLWJ1aWxkJyxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIGJ1aWxkSW1hZ2U6IGNvZGVidWlsZC5MaW51eEJ1aWxkSW1hZ2UuQU1BWk9OX0xJTlVYXzJfMyxcbiAgICAgICAgcHJpdmlsZWdlZDogdHJ1ZSwgLy8gUmVxdWlyZWQgZm9yIERvY2tlciBidWlsZHNcbiAgICAgIH0sXG4gICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xuICAgICAgICBSRVBPU0lUT1JZX1VSSToge1xuICAgICAgICAgIHZhbHVlOiBlY3JSZXBvLnJlcG9zaXRvcnlVcmksXG4gICAgICAgIH0sXG4gICAgICAgIENPTlRBSU5FUl9OQU1FOiB7XG4gICAgICAgICAgdmFsdWU6ICdjb2RlcGlwZWxpbmUtZGVtbycsXG4gICAgICAgIH0sXG4gICAgICAgIEFQUF9SRUdJT046IHtcbiAgICAgICAgICB2YWx1ZTogcmVnaW9uQ29uZmlnLmFwcFJlZ2lvbixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBidWlsZFNwZWM6IGNvZGVidWlsZC5CdWlsZFNwZWMuZnJvbU9iamVjdCh7XG4gICAgICAgIHZlcnNpb246ICcwLjInLFxuICAgICAgICBwaGFzZXM6IHtcbiAgICAgICAgICBwcmVfYnVpbGQ6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAgICdlY2hvIExvZ2dpbmcgaW4gdG8gQW1hem9uIEVDUi4uLicsXG4gICAgICAgICAgICAgICdhd3MgZWNyIGdldC1sb2dpbi1wYXNzd29yZCAtLXJlZ2lvbiAkQVdTX0RFRkFVTFRfUkVHSU9OIHwgZG9ja2VyIGxvZ2luIC0tdXNlcm5hbWUgQVdTIC0tcGFzc3dvcmQtc3RkaW4gJFJFUE9TSVRPUllfVVJJJyxcbiAgICAgICAgICAgICAgJ0NPTU1JVF9IQVNIPSQoZWNobyAkQ09ERUJVSUxEX1JFU09MVkVEX1NPVVJDRV9WRVJTSU9OIHwgY3V0IC1jIDEtNyknLFxuICAgICAgICAgICAgICAnSU1BR0VfVEFHPSR7Q09NTUlUX0hBU0g6PWxhdGVzdH0nLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnZWNobyBCdWlsZGluZyB0aGUgRG9ja2VyIGltYWdlLi4uJyxcbiAgICAgICAgICAgICAgJ2NkIGFwcCcsXG4gICAgICAgICAgICAgICdkb2NrZXIgYnVpbGQgLXQgJFJFUE9TSVRPUllfVVJJOmxhdGVzdCAuJyxcbiAgICAgICAgICAgICAgJ2RvY2tlciB0YWcgJFJFUE9TSVRPUllfVVJJOmxhdGVzdCAkUkVQT1NJVE9SWV9VUkk6JElNQUdFX1RBRycsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgcG9zdF9idWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ2VjaG8gUHVzaGluZyB0aGUgRG9ja2VyIGltYWdlIHRvIHBpcGVsaW5lIHJlZ2lvbi4uLicsXG4gICAgICAgICAgICAgICdkb2NrZXIgcHVzaCAkUkVQT1NJVE9SWV9VUkk6bGF0ZXN0JyxcbiAgICAgICAgICAgICAgJ2RvY2tlciBwdXNoICRSRVBPU0lUT1JZX1VSSTokSU1BR0VfVEFHJyxcbiAgICAgICAgICAgICAgJ2VjaG8gQ3JlYXRpbmcgcmVwb3NpdG9yeSBpbiBhcHAgcmVnaW9uIGlmIGl0IGRvZXMgbm90IGV4aXN0Li4uJyxcbiAgICAgICAgICAgICAgJ2F3cyBlY3IgZGVzY3JpYmUtcmVwb3NpdG9yaWVzIC0tcmVwb3NpdG9yeS1uYW1lcyBjb2RlcGlwZWxpbmUtZGVtbyAtLXJlZ2lvbiAkQVBQX1JFR0lPTiB8fCBhd3MgZWNyIGNyZWF0ZS1yZXBvc2l0b3J5IC0tcmVwb3NpdG9yeS1uYW1lIGNvZGVwaXBlbGluZS1kZW1vIC0tcmVnaW9uICRBUFBfUkVHSU9OJyxcbiAgICAgICAgICAgICAgJ2VjaG8gUHVzaGluZyB0aGUgRG9ja2VyIGltYWdlIHRvIGFwcCByZWdpb24uLi4nLFxuICAgICAgICAgICAgICAnQVBQX1JFUE89JChlY2hvICRSRVBPU0lUT1JZX1VSSSB8IHNlZCBcInMvJyArIHJlZ2lvbkNvbmZpZy5waXBlbGluZVJlZ2lvbiArICcvJyArIHJlZ2lvbkNvbmZpZy5hcHBSZWdpb24gKyAnL2dcIiknLFxuICAgICAgICAgICAgICAnYXdzIGVjciBnZXQtbG9naW4tcGFzc3dvcmQgLS1yZWdpb24gJEFQUF9SRUdJT04gfCBkb2NrZXIgbG9naW4gLS11c2VybmFtZSBBV1MgLS1wYXNzd29yZC1zdGRpbiAkQVBQX1JFUE8nLFxuICAgICAgICAgICAgICAnZG9ja2VyIHRhZyAkUkVQT1NJVE9SWV9VUkk6bGF0ZXN0ICRBUFBfUkVQTzpsYXRlc3QnLFxuICAgICAgICAgICAgICAnZG9ja2VyIHRhZyAkUkVQT1NJVE9SWV9VUkk6JElNQUdFX1RBRyAkQVBQX1JFUE86JElNQUdFX1RBRycsXG4gICAgICAgICAgICAgICdkb2NrZXIgcHVzaCAkQVBQX1JFUE86bGF0ZXN0JyxcbiAgICAgICAgICAgICAgJ2RvY2tlciBwdXNoICRBUFBfUkVQTzokSU1BR0VfVEFHJyxcbiAgICAgICAgICAgICAgJ2VjaG8gVXBkYXRpbmcgRUNTIHNlcnZpY2UgaW4gYXBwIHJlZ2lvbi4uLicsXG4gICAgICAgICAgICAgICdhd3MgZWNzIHVwZGF0ZS1zZXJ2aWNlIC0tY2x1c3RlciBjb2RlcGlwZWxpbmUtZGVtby1jbHVzdGVyIC0tc2VydmljZSBjb2RlcGlwZWxpbmUtZGVtby1zZXJ2aWNlIC0tZm9yY2UtbmV3LWRlcGxveW1lbnQgLS1yZWdpb24gJEFQUF9SRUdJT04nLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyB0byBDb2RlQnVpbGRcbiAgICBlY3JSZXBvLmdyYW50UHVsbFB1c2goYnVpbGRQcm9qZWN0LnJvbGUhKTtcbiAgICBidWlsZFByb2plY3QuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnZWNzOlVwZGF0ZVNlcnZpY2UnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgLy8gQWRkIGNyb3NzLXJlZ2lvbiBwZXJtaXNzaW9ucyBmb3IgRUNSIGFuZCBFQ1NcbiAgICBidWlsZFByb2plY3QuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2VjcjpHZXRBdXRob3JpemF0aW9uVG9rZW4nLFxuICAgICAgICAnZWNyOkJhdGNoQ2hlY2tMYXllckF2YWlsYWJpbGl0eScsXG4gICAgICAgICdlY3I6R2V0RG93bmxvYWRVcmxGb3JMYXllcicsXG4gICAgICAgICdlY3I6QmF0Y2hHZXRJbWFnZScsXG4gICAgICAgICdlY3I6SW5pdGlhdGVMYXllclVwbG9hZCcsXG4gICAgICAgICdlY3I6VXBsb2FkTGF5ZXJQYXJ0JyxcbiAgICAgICAgJ2VjcjpDb21wbGV0ZUxheWVyVXBsb2FkJyxcbiAgICAgICAgJ2VjcjpQdXRJbWFnZSdcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcbiAgICBcbiAgICAvLyBBZGQgcGVybWlzc2lvbnMgdG8gY3JlYXRlIEVDUiByZXBvc2l0b3J5IGluIHRoZSBhcHAgcmVnaW9uXG4gICAgYnVpbGRQcm9qZWN0LmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdlY3I6Q3JlYXRlUmVwb3NpdG9yeScsXG4gICAgICAgICdlY3I6UHV0TGlmZWN5Y2xlUG9saWN5J1xuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWydhcm46YXdzOmVjcjonICsgcmVnaW9uQ29uZmlnLmFwcFJlZ2lvbiArICc6JyArIHJlZ2lvbkNvbmZpZy5hY2NvdW50SWQgKyAnOnJlcG9zaXRvcnkvY29kZXBpcGVsaW5lLWRlbW8nXSxcbiAgICB9KSk7XG5cbiAgICAvLyBDb2RlUGlwZWxpbmVcbiAgICBjb25zdCBzb3VyY2VPdXRwdXQgPSBuZXcgY29kZXBpcGVsaW5lLkFydGlmYWN0KCk7XG4gICAgY29uc3QgYnVpbGRPdXRwdXQgPSBuZXcgY29kZXBpcGVsaW5lLkFydGlmYWN0KCk7XG5cbiAgICBjb25zdCBwaXBlbGluZSA9IG5ldyBjb2RlcGlwZWxpbmUuUGlwZWxpbmUodGhpcywgJ0NvZGVwaXBlbGluZURlbW9QaXBlbGluZScsIHtcbiAgICAgIHBpcGVsaW5lTmFtZTogJ2NvZGVwaXBlbGluZS1kZW1vLXBpcGVsaW5lJyxcbiAgICAgIHJlc3RhcnRFeGVjdXRpb25PblVwZGF0ZTogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIFNvdXJjZSBTdGFnZVxuICAgIHBpcGVsaW5lLmFkZFN0YWdlKHtcbiAgICAgIHN0YWdlTmFtZTogJ1NvdXJjZScsXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgIG5ldyBjb2RlcGlwZWxpbmVfYWN0aW9ucy5Db2RlU3RhckNvbm5lY3Rpb25zU291cmNlQWN0aW9uKHtcbiAgICAgICAgICBhY3Rpb25OYW1lOiAnR2l0SHViX1NvdXJjZScsXG4gICAgICAgICAgb3duZXI6IGdpdGh1YkNvbmZpZy5vd25lcixcbiAgICAgICAgICByZXBvOiBnaXRodWJDb25maWcucmVwbyxcbiAgICAgICAgICBicmFuY2g6IGdpdGh1YkNvbmZpZy5icmFuY2gsXG4gICAgICAgICAgY29ubmVjdGlvbkFybjogZ2l0aHViQ29uZmlnLmNvbm5lY3Rpb25Bcm4sXG4gICAgICAgICAgb3V0cHV0OiBzb3VyY2VPdXRwdXQsXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIEJ1aWxkIFN0YWdlXG4gICAgcGlwZWxpbmUuYWRkU3RhZ2Uoe1xuICAgICAgc3RhZ2VOYW1lOiAnQnVpbGQnLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICBuZXcgY29kZXBpcGVsaW5lX2FjdGlvbnMuQ29kZUJ1aWxkQWN0aW9uKHtcbiAgICAgICAgICBhY3Rpb25OYW1lOiAnQnVpbGRBbmRQdXNoJyxcbiAgICAgICAgICBwcm9qZWN0OiBidWlsZFByb2plY3QsXG4gICAgICAgICAgaW5wdXQ6IHNvdXJjZU91dHB1dCxcbiAgICAgICAgICBvdXRwdXRzOiBbYnVpbGRPdXRwdXRdLFxuICAgICAgICB9KSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBPdXRwdXRzXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0VjclJlcG9zaXRvcnlVcmknLCB7XG4gICAgICB2YWx1ZTogZWNyUmVwby5yZXBvc2l0b3J5VXJpLFxuICAgICAgZGVzY3JpcHRpb246ICdVUkkgb2YgdGhlIEVDUiBSZXBvc2l0b3J5JyxcbiAgICB9KTtcbiAgfVxufSJdfQ==