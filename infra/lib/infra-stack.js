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
exports.InfraStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const ecr = __importStar(require("aws-cdk-lib/aws-ecr"));
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const codebuild = __importStar(require("aws-cdk-lib/aws-codebuild"));
const codepipeline = __importStar(require("aws-cdk-lib/aws-codepipeline"));
const codepipeline_actions = __importStar(require("aws-cdk-lib/aws-codepipeline-actions"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const elbv2 = __importStar(require("aws-cdk-lib/aws-elasticloadbalancingv2"));
const config_1 = require("./config");
class InfraStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Add a Name tag to all resources in this stack
        cdk.Tags.of(this).add('Name', 'codepipeline-demo');
        // ECR Repository
        const ecrRepo = new ecr.Repository(this, 'CodepipelineDemoEcrRepo', {
            repositoryName: 'codepipeline-demo',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            emptyOnDelete: true, // Using emptyOnDelete instead of deprecated autoDeleteImages
        });
        // VPC for Fargate
        const vpc = new ec2.Vpc(this, 'CodepipelineDemoVpc', {
            maxAzs: 2,
            natGateways: 1,
        });
        // ECS Cluster
        const cluster = new ecs.Cluster(this, 'CodepipelineDemoCluster', {
            vpc,
            clusterName: 'codepipeline-demo-cluster',
        });
        // Task Definition
        const taskDefinition = new ecs.FargateTaskDefinition(this, 'CodepipelineDemoTaskDef', {
            memoryLimitMiB: 512,
            cpu: 256,
        });
        // Add container to task definition
        const containerName = 'codepipeline-demo';
        const container = taskDefinition.addContainer(containerName, {
            image: ecs.ContainerImage.fromEcrRepository(ecrRepo),
            logging: ecs.LogDrivers.awsLogs({
                streamPrefix: 'codepipeline-demo',
                logRetention: logs.RetentionDays.ONE_WEEK,
            }),
            portMappings: [{ containerPort: 8080 }],
        });
        // Create a security group for the Application Load Balancer
        const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
            vpc,
            description: 'Security group for the Application Load Balancer',
            allowAllOutbound: true,
        });
        albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP traffic from internet');
        // Create a security group for the Fargate service
        const serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
            vpc,
            description: 'Security group for the Fargate service',
            allowAllOutbound: true,
        });
        serviceSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(8080), 'Allow traffic from ALB on port 8080 only');
        // Create an Application Load Balancer
        const lb = new elbv2.ApplicationLoadBalancer(this, 'CodepipelineDemoLoadBalancer', {
            vpc,
            internetFacing: true,
            securityGroup: albSecurityGroup,
        });
        // Add a listener to the load balancer
        const listener = lb.addListener('Listener', {
            port: 80,
            open: true,
        });
        // Fargate Service
        const fargateService = new ecs.FargateService(this, 'CodepipelineDemoService', {
            cluster,
            taskDefinition,
            desiredCount: 1,
            assignPublicIp: false, // Using private subnets with NAT gateway
            serviceName: 'codepipeline-demo-service',
            securityGroups: [serviceSecurityGroup],
        });
        // Add the Fargate service as a target to the load balancer
        listener.addTargets('FargateTarget', {
            port: 8080,
            targets: [fargateService],
            healthCheck: {
                enabled: true,
                path: '/health',
                protocol: elbv2.Protocol.HTTP,
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 2,
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(5),
            },
        });
        // No API Gateway or VPC Link needed - the ALB will directly expose the service
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
                    value: containerName,
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
                            'echo Pushing the Docker image...',
                            'docker push $REPOSITORY_URI:latest',
                            'docker push $REPOSITORY_URI:$IMAGE_TAG',
                            'echo Writing image definitions file...',
                            'aws ecs update-service --cluster codepipeline-demo-cluster --service codepipeline-demo-service --force-new-deployment',
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
        new cdk.CfnOutput(this, 'ApplicationUrl', {
            value: `http://${lb.loadBalancerDnsName}`,
            description: 'URL of the Application',
        });
        new cdk.CfnOutput(this, 'EcrRepositoryUri', {
            value: ecrRepo.repositoryUri,
            description: 'URI of the ECR Repository',
        });
    }
}
exports.InfraStack = InfraStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mcmEtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmZyYS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUVuQyx5REFBMkM7QUFDM0MseURBQTJDO0FBQzNDLHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MscUVBQXVEO0FBQ3ZELDJFQUE2RDtBQUM3RCwyRkFBNkU7QUFDN0UsMkRBQTZDO0FBQzdDLDhFQUFnRTtBQUNoRSxxQ0FBd0M7QUFFeEMsTUFBYSxVQUFXLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDdkMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixnREFBZ0Q7UUFDaEQsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQU0sRUFBRSxtQkFBbUIsQ0FBQyxDQUFDO1FBRW5ELGlCQUFpQjtRQUNqQixNQUFNLE9BQU8sR0FBRyxJQUFJLEdBQUcsQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLHlCQUF5QixFQUFFO1lBQ2xFLGNBQWMsRUFBRSxtQkFBbUI7WUFDbkMsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTztZQUN4QyxhQUFhLEVBQUUsSUFBSSxFQUFFLDZEQUE2RDtTQUNuRixDQUFDLENBQUM7UUFFSCxrQkFBa0I7UUFDbEIsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRTtZQUNuRCxNQUFNLEVBQUUsQ0FBQztZQUNULFdBQVcsRUFBRSxDQUFDO1NBQ2YsQ0FBQyxDQUFDO1FBRUgsY0FBYztRQUNkLE1BQU0sT0FBTyxHQUFHLElBQUksR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUseUJBQXlC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QUFPLEVBQUUsWUFBWTtvQkFDckIsS0FBSyxFQUFFLFlBQVk7b0JBQ25CLE9BQU8sRUFBRSxDQUFDLFdBQVcsQ0FBQztpQkFDdkIsQ0FBQzthQUNIO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsVUFBVTtRQUNWLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDeEMsS0FBSyxFQUFFLFVBQVUsRUFBRSxDQUFDLG1CQUFtQixFQUFFO1lBQ3pDLFdBQVcsRUFBRSx3QkFBd0I7U0FDdEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsT0FBTyxDQUFDLGFBQWE7WUFDNUIsV0FBVyxFQUFFLDJCQUEyQjtTQUN6QyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF6TUQsZ0NBeU1DIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgZWNyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3InO1xuaW1wb3J0ICogYXMgZWNzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MnO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgY29kZWJ1aWxkIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2RlYnVpbGQnO1xuaW1wb3J0ICogYXMgY29kZXBpcGVsaW5lIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2RlcGlwZWxpbmUnO1xuaW1wb3J0ICogYXMgY29kZXBpcGVsaW5lX2FjdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVwaXBlbGluZS1hY3Rpb25zJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0ICogYXMgZWxidjIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVsYXN0aWNsb2FkYmFsYW5jaW5ndjInO1xuaW1wb3J0IHsgZ2l0aHViQ29uZmlnIH0gZnJvbSAnLi9jb25maWcnO1xuXG5leHBvcnQgY2xhc3MgSW5mcmFTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcbiAgICBcbiAgICAvLyBBZGQgYSBOYW1lIHRhZyB0byBhbGwgcmVzb3VyY2VzIGluIHRoaXMgc3RhY2tcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ05hbWUnLCAnY29kZXBpcGVsaW5lLWRlbW8nKTtcblxuICAgIC8vIEVDUiBSZXBvc2l0b3J5XG4gICAgY29uc3QgZWNyUmVwbyA9IG5ldyBlY3IuUmVwb3NpdG9yeSh0aGlzLCAnQ29kZXBpcGVsaW5lRGVtb0VjclJlcG8nLCB7XG4gICAgICByZXBvc2l0b3J5TmFtZTogJ2NvZGVwaXBlbGluZS1kZW1vJyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBlbXB0eU9uRGVsZXRlOiB0cnVlLCAvLyBVc2luZyBlbXB0eU9uRGVsZXRlIGluc3RlYWQgb2YgZGVwcmVjYXRlZCBhdXRvRGVsZXRlSW1hZ2VzXG4gICAgfSk7XG5cbiAgICAvLyBWUEMgZm9yIEZhcmdhdGVcbiAgICBjb25zdCB2cGMgPSBuZXcgZWMyLlZwYyh0aGlzLCAnQ29kZXBpcGVsaW5lRGVtb1ZwYycsIHtcbiAgICAgIG1heEF6czogMixcbiAgICAgIG5hdEdhdGV3YXlzOiAxLFxuICAgIH0pO1xuXG4gICAgLy8gRUNTIENsdXN0ZXJcbiAgICBjb25zdCBjbHVzdGVyID0gbmV3IGVjcy5DbHVzdGVyKHRoaXMsICdDb2RlcGlwZWxpbmVEZW1vQ2x1c3RlcicsIHtcbiAgICAgIHZwYyxcbiAgICAgIGNsdXN0ZXJOYW1lOiAnY29kZXBpcGVsaW5lLWRlbW8tY2x1c3RlcicsXG4gICAgfSk7XG5cbiAgICAvLyBUYXNrIERlZmluaXRpb25cbiAgICBjb25zdCB0YXNrRGVmaW5pdGlvbiA9IG5ldyBlY3MuRmFyZ2F0ZVRhc2tEZWZpbml0aW9uKHRoaXMsICdDb2RlcGlwZWxpbmVEZW1vVGFza0RlZicsIHtcbiAgICAgIG1lbW9yeUxpbWl0TWlCOiA1MTIsXG4gICAgICBjcHU6IDI1NixcbiAgICB9KTtcblxuICAgIC8vIEFkZCBjb250YWluZXIgdG8gdGFzayBkZWZpbml0aW9uXG4gICAgY29uc3QgY29udGFpbmVyTmFtZSA9ICdjb2RlcGlwZWxpbmUtZGVtbyc7XG4gICAgY29uc3QgY29udGFpbmVyID0gdGFza0RlZmluaXRpb24uYWRkQ29udGFpbmVyKGNvbnRhaW5lck5hbWUsIHtcbiAgICAgIGltYWdlOiBlY3MuQ29udGFpbmVySW1hZ2UuZnJvbUVjclJlcG9zaXRvcnkoZWNyUmVwbyksXG4gICAgICBsb2dnaW5nOiBlY3MuTG9nRHJpdmVycy5hd3NMb2dzKHtcbiAgICAgICAgc3RyZWFtUHJlZml4OiAnY29kZXBpcGVsaW5lLWRlbW8nLFxuICAgICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgIH0pLFxuICAgICAgcG9ydE1hcHBpbmdzOiBbeyBjb250YWluZXJQb3J0OiA4MDgwIH1dLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIGEgc2VjdXJpdHkgZ3JvdXAgZm9yIHRoZSBBcHBsaWNhdGlvbiBMb2FkIEJhbGFuY2VyXG4gICAgY29uc3QgYWxiU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnQWxiU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIHZwYyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgZ3JvdXAgZm9yIHRoZSBBcHBsaWNhdGlvbiBMb2FkIEJhbGFuY2VyJyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IHRydWUsXG4gICAgfSk7XG4gICAgYWxiU2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShlYzIuUGVlci5hbnlJcHY0KCksIGVjMi5Qb3J0LnRjcCg4MCksICdBbGxvdyBIVFRQIHRyYWZmaWMgZnJvbSBpbnRlcm5ldCcpO1xuXG4gICAgLy8gQ3JlYXRlIGEgc2VjdXJpdHkgZ3JvdXAgZm9yIHRoZSBGYXJnYXRlIHNlcnZpY2VcbiAgICBjb25zdCBzZXJ2aWNlU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnU2VydmljZVNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGMsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlY3VyaXR5IGdyb3VwIGZvciB0aGUgRmFyZ2F0ZSBzZXJ2aWNlJyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IHRydWUsXG4gICAgfSk7XG4gICAgc2VydmljZVNlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoYWxiU2VjdXJpdHlHcm91cCwgZWMyLlBvcnQudGNwKDgwODApLCAnQWxsb3cgdHJhZmZpYyBmcm9tIEFMQiBvbiBwb3J0IDgwODAgb25seScpO1xuXG4gICAgLy8gQ3JlYXRlIGFuIEFwcGxpY2F0aW9uIExvYWQgQmFsYW5jZXJcbiAgICBjb25zdCBsYiA9IG5ldyBlbGJ2Mi5BcHBsaWNhdGlvbkxvYWRCYWxhbmNlcih0aGlzLCAnQ29kZXBpcGVsaW5lRGVtb0xvYWRCYWxhbmNlcicsIHtcbiAgICAgIHZwYyxcbiAgICAgIGludGVybmV0RmFjaW5nOiB0cnVlLFxuICAgICAgc2VjdXJpdHlHcm91cDogYWxiU2VjdXJpdHlHcm91cCxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBhIGxpc3RlbmVyIHRvIHRoZSBsb2FkIGJhbGFuY2VyXG4gICAgY29uc3QgbGlzdGVuZXIgPSBsYi5hZGRMaXN0ZW5lcignTGlzdGVuZXInLCB7XG4gICAgICBwb3J0OiA4MCxcbiAgICAgIG9wZW46IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyBGYXJnYXRlIFNlcnZpY2VcbiAgICBjb25zdCBmYXJnYXRlU2VydmljZSA9IG5ldyBlY3MuRmFyZ2F0ZVNlcnZpY2UodGhpcywgJ0NvZGVwaXBlbGluZURlbW9TZXJ2aWNlJywge1xuICAgICAgY2x1c3RlcixcbiAgICAgIHRhc2tEZWZpbml0aW9uLFxuICAgICAgZGVzaXJlZENvdW50OiAxLFxuICAgICAgYXNzaWduUHVibGljSXA6IGZhbHNlLCAvLyBVc2luZyBwcml2YXRlIHN1Ym5ldHMgd2l0aCBOQVQgZ2F0ZXdheVxuICAgICAgc2VydmljZU5hbWU6ICdjb2RlcGlwZWxpbmUtZGVtby1zZXJ2aWNlJyxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbc2VydmljZVNlY3VyaXR5R3JvdXBdLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIHRoZSBGYXJnYXRlIHNlcnZpY2UgYXMgYSB0YXJnZXQgdG8gdGhlIGxvYWQgYmFsYW5jZXJcbiAgICBsaXN0ZW5lci5hZGRUYXJnZXRzKCdGYXJnYXRlVGFyZ2V0Jywge1xuICAgICAgcG9ydDogODA4MCxcbiAgICAgIHRhcmdldHM6IFtmYXJnYXRlU2VydmljZV0sXG4gICAgICBoZWFsdGhDaGVjazoge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBwYXRoOiAnL2hlYWx0aCcsXG4gICAgICAgIHByb3RvY29sOiBlbGJ2Mi5Qcm90b2NvbC5IVFRQLFxuICAgICAgICBoZWFsdGh5VGhyZXNob2xkQ291bnQ6IDIsXG4gICAgICAgIHVuaGVhbHRoeVRocmVzaG9sZENvdW50OiAyLFxuICAgICAgICBpbnRlcnZhbDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcyg1KSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBObyBBUEkgR2F0ZXdheSBvciBWUEMgTGluayBuZWVkZWQgLSB0aGUgQUxCIHdpbGwgZGlyZWN0bHkgZXhwb3NlIHRoZSBzZXJ2aWNlXG5cbiAgICAvLyBDb2RlQnVpbGQgUHJvamVjdFxuICAgIGNvbnN0IGJ1aWxkUHJvamVjdCA9IG5ldyBjb2RlYnVpbGQuUGlwZWxpbmVQcm9qZWN0KHRoaXMsICdDb2RlcGlwZWxpbmVEZW1vQnVpbGRQcm9qZWN0Jywge1xuICAgICAgcHJvamVjdE5hbWU6ICdjb2RlcGlwZWxpbmUtZGVtby1idWlsZCcsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBidWlsZEltYWdlOiBjb2RlYnVpbGQuTGludXhCdWlsZEltYWdlLkFNQVpPTl9MSU5VWF8yXzMsXG4gICAgICAgIHByaXZpbGVnZWQ6IHRydWUsIC8vIFJlcXVpcmVkIGZvciBEb2NrZXIgYnVpbGRzXG4gICAgICB9LFxuICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgUkVQT1NJVE9SWV9VUkk6IHtcbiAgICAgICAgICB2YWx1ZTogZWNyUmVwby5yZXBvc2l0b3J5VXJpLFxuICAgICAgICB9LFxuICAgICAgICBDT05UQUlORVJfTkFNRToge1xuICAgICAgICAgIHZhbHVlOiBjb250YWluZXJOYW1lLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGJ1aWxkU3BlYzogY29kZWJ1aWxkLkJ1aWxkU3BlYy5mcm9tT2JqZWN0KHtcbiAgICAgICAgdmVyc2lvbjogJzAuMicsXG4gICAgICAgIHBoYXNlczoge1xuICAgICAgICAgIHByZV9idWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ2VjaG8gTG9nZ2luZyBpbiB0byBBbWF6b24gRUNSLi4uJyxcbiAgICAgICAgICAgICAgJ2F3cyBlY3IgZ2V0LWxvZ2luLXBhc3N3b3JkIC0tcmVnaW9uICRBV1NfREVGQVVMVF9SRUdJT04gfCBkb2NrZXIgbG9naW4gLS11c2VybmFtZSBBV1MgLS1wYXNzd29yZC1zdGRpbiAkUkVQT1NJVE9SWV9VUkknLFxuICAgICAgICAgICAgICAnQ09NTUlUX0hBU0g9JChlY2hvICRDT0RFQlVJTERfUkVTT0xWRURfU09VUkNFX1ZFUlNJT04gfCBjdXQgLWMgMS03KScsXG4gICAgICAgICAgICAgICdJTUFHRV9UQUc9JHtDT01NSVRfSEFTSDo9bGF0ZXN0fScsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgYnVpbGQ6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAgICdlY2hvIEJ1aWxkaW5nIHRoZSBEb2NrZXIgaW1hZ2UuLi4nLFxuICAgICAgICAgICAgICAnY2QgYXBwJyxcbiAgICAgICAgICAgICAgJ2RvY2tlciBidWlsZCAtdCAkUkVQT1NJVE9SWV9VUkk6bGF0ZXN0IC4nLFxuICAgICAgICAgICAgICAnZG9ja2VyIHRhZyAkUkVQT1NJVE9SWV9VUkk6bGF0ZXN0ICRSRVBPU0lUT1JZX1VSSTokSU1BR0VfVEFHJyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwb3N0X2J1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnZWNobyBQdXNoaW5nIHRoZSBEb2NrZXIgaW1hZ2UuLi4nLFxuICAgICAgICAgICAgICAnZG9ja2VyIHB1c2ggJFJFUE9TSVRPUllfVVJJOmxhdGVzdCcsXG4gICAgICAgICAgICAgICdkb2NrZXIgcHVzaCAkUkVQT1NJVE9SWV9VUkk6JElNQUdFX1RBRycsXG4gICAgICAgICAgICAgICdlY2hvIFdyaXRpbmcgaW1hZ2UgZGVmaW5pdGlvbnMgZmlsZS4uLicsXG4gICAgICAgICAgICAgICdhd3MgZWNzIHVwZGF0ZS1zZXJ2aWNlIC0tY2x1c3RlciBjb2RlcGlwZWxpbmUtZGVtby1jbHVzdGVyIC0tc2VydmljZSBjb2RlcGlwZWxpbmUtZGVtby1zZXJ2aWNlIC0tZm9yY2UtbmV3LWRlcGxveW1lbnQnLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyB0byBDb2RlQnVpbGRcbiAgICBlY3JSZXBvLmdyYW50UHVsbFB1c2goYnVpbGRQcm9qZWN0LnJvbGUhKTtcbiAgICBidWlsZFByb2plY3QuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnZWNzOlVwZGF0ZVNlcnZpY2UnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgLy8gQ29kZVBpcGVsaW5lXG4gICAgY29uc3Qgc291cmNlT3V0cHV0ID0gbmV3IGNvZGVwaXBlbGluZS5BcnRpZmFjdCgpO1xuICAgIGNvbnN0IGJ1aWxkT3V0cHV0ID0gbmV3IGNvZGVwaXBlbGluZS5BcnRpZmFjdCgpO1xuXG4gICAgY29uc3QgcGlwZWxpbmUgPSBuZXcgY29kZXBpcGVsaW5lLlBpcGVsaW5lKHRoaXMsICdDb2RlcGlwZWxpbmVEZW1vUGlwZWxpbmUnLCB7XG4gICAgICBwaXBlbGluZU5hbWU6ICdjb2RlcGlwZWxpbmUtZGVtby1waXBlbGluZScsXG4gICAgICByZXN0YXJ0RXhlY3V0aW9uT25VcGRhdGU6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyBTb3VyY2UgU3RhZ2VcbiAgICBwaXBlbGluZS5hZGRTdGFnZSh7XG4gICAgICBzdGFnZU5hbWU6ICdTb3VyY2UnLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICBuZXcgY29kZXBpcGVsaW5lX2FjdGlvbnMuQ29kZVN0YXJDb25uZWN0aW9uc1NvdXJjZUFjdGlvbih7XG4gICAgICAgICAgYWN0aW9uTmFtZTogJ0dpdEh1Yl9Tb3VyY2UnLFxuICAgICAgICAgIG93bmVyOiBnaXRodWJDb25maWcub3duZXIsXG4gICAgICAgICAgcmVwbzogZ2l0aHViQ29uZmlnLnJlcG8sXG4gICAgICAgICAgYnJhbmNoOiBnaXRodWJDb25maWcuYnJhbmNoLFxuICAgICAgICAgIGNvbm5lY3Rpb25Bcm46IGdpdGh1YkNvbmZpZy5jb25uZWN0aW9uQXJuLFxuICAgICAgICAgIG91dHB1dDogc291cmNlT3V0cHV0LFxuICAgICAgICB9KSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBCdWlsZCBTdGFnZVxuICAgIHBpcGVsaW5lLmFkZFN0YWdlKHtcbiAgICAgIHN0YWdlTmFtZTogJ0J1aWxkJyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgbmV3IGNvZGVwaXBlbGluZV9hY3Rpb25zLkNvZGVCdWlsZEFjdGlvbih7XG4gICAgICAgICAgYWN0aW9uTmFtZTogJ0J1aWxkQW5kUHVzaCcsXG4gICAgICAgICAgcHJvamVjdDogYnVpbGRQcm9qZWN0LFxuICAgICAgICAgIGlucHV0OiBzb3VyY2VPdXRwdXQsXG4gICAgICAgICAgb3V0cHV0czogW2J1aWxkT3V0cHV0XSxcbiAgICAgICAgfSksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcHBsaWNhdGlvblVybCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cDovLyR7bGIubG9hZEJhbGFuY2VyRG5zTmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdVUkwgb2YgdGhlIEFwcGxpY2F0aW9uJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdFY3JSZXBvc2l0b3J5VXJpJywge1xuICAgICAgdmFsdWU6IGVjclJlcG8ucmVwb3NpdG9yeVVyaSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVVJJIG9mIHRoZSBFQ1IgUmVwb3NpdG9yeScsXG4gICAgfSk7XG4gIH1cbn0iXX0=