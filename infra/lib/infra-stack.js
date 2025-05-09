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
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const codebuild = __importStar(require("aws-cdk-lib/aws-codebuild"));
const codepipeline = __importStar(require("aws-cdk-lib/aws-codepipeline"));
const codepipeline_actions = __importStar(require("aws-cdk-lib/aws-codepipeline-actions"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const elbv2 = __importStar(require("aws-cdk-lib/aws-elasticloadbalancingv2"));
class InfraStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // ECR Repository
        const ecrRepo = new ecr.Repository(this, 'AmaEcrRepo', {
            repositoryName: 'ama-demo',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteImages: true,
        });
        // VPC for Fargate
        const vpc = new ec2.Vpc(this, 'AmaVpc', {
            maxAzs: 2,
            natGateways: 1,
        });
        // ECS Cluster
        const cluster = new ecs.Cluster(this, 'AmaCluster', {
            vpc,
            clusterName: 'ama-cluster',
        });
        // Task Definition
        const taskDefinition = new ecs.FargateTaskDefinition(this, 'AmaTaskDef', {
            memoryLimitMiB: 512,
            cpu: 256,
        });
        // Add container to task definition
        const containerName = 'ama-demo';
        const container = taskDefinition.addContainer(containerName, {
            image: ecs.ContainerImage.fromEcrRepository(ecrRepo),
            logging: ecs.LogDrivers.awsLogs({
                streamPrefix: 'ama-demo',
                logRetention: logs.RetentionDays.ONE_WEEK,
            }),
            portMappings: [{ containerPort: 8080 }],
        });
        // Create a security group for the load balancer
        const lbSecurityGroup = new ec2.SecurityGroup(this, 'LBSecurityGroup', {
            vpc,
            description: 'Security group for the load balancer',
            allowAllOutbound: true,
        });
        lbSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP traffic');
        // Create a security group for the Fargate service
        const serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', {
            vpc,
            description: 'Security group for the Fargate service',
            allowAllOutbound: true,
        });
        serviceSecurityGroup.addIngressRule(lbSecurityGroup, ec2.Port.tcp(8080), 'Allow traffic from LB');
        // Create a Network Load Balancer (required for VPC Link)
        const lb = new elbv2.NetworkLoadBalancer(this, 'AmaLoadBalancer', {
            vpc,
            internetFacing: true,
        });
        // Add a listener to the load balancer
        const listener = lb.addListener('Listener', {
            port: 80,
        });
        // Fargate Service
        const fargateService = new ecs.FargateService(this, 'AmaService', {
            cluster,
            taskDefinition,
            desiredCount: 1,
            assignPublicIp: false, // Using private subnets with NAT gateway
            serviceName: 'ama-service',
            securityGroups: [serviceSecurityGroup],
        });
        // Add the Fargate service as a target to the load balancer
        listener.addTargets('FargateTarget', {
            port: 8080,
            targets: [fargateService],
            healthCheck: {
                enabled: true,
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 2,
                interval: cdk.Duration.seconds(10),
            },
        });
        // API Gateway
        const api = new apigateway.RestApi(this, 'AmaGateway', {
            restApiName: 'ama-gateway1',
            description: 'API Gateway for AMA Demo',
            deployOptions: {
                stageName: 'prod',
            },
        });
        // Create a VPC Link for API Gateway to access the Network Load Balancer
        const vpcLink = new apigateway.VpcLink(this, 'AmaVpcLink', {
            targets: [lb],
        });
        // Integration between API Gateway and NLB
        const integration = new apigateway.Integration({
            type: apigateway.IntegrationType.HTTP_PROXY,
            integrationHttpMethod: 'ANY',
            uri: `http://${lb.loadBalancerDnsName}/`,
            options: {
                connectionType: apigateway.ConnectionType.VPC_LINK,
                vpcLink,
            },
        });
        // Add root resource with ANY method
        api.root.addMethod('ANY', integration);
        // CodeBuild Project
        const buildProject = new codebuild.PipelineProject(this, 'AmaBuildProject', {
            projectName: 'ama-build',
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
                            'aws ecs update-service --cluster ama-cluster --service ama-service --force-new-deployment',
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
        const pipeline = new codepipeline.Pipeline(this, 'AmaPipeline', {
            pipelineName: 'ama-pipeline',
            restartExecutionOnUpdate: true,
        });
        // Source Stage
        pipeline.addStage({
            stageName: 'Source',
            actions: [
                new codepipeline_actions.CodeStarConnectionsSourceAction({
                    actionName: 'GitHub_Source',
                    owner: 'brentgfoxaws',
                    repo: 'ama-codepipeline',
                    branch: 'main',
                    connectionArn: 'arn:aws:codeconnections:ca-central-1:582828318008:connection/adbb8f63-cfe1-43de-b7c2-05ecf23e21b7',
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
        new cdk.CfnOutput(this, 'ApiGatewayUrl', {
            value: api.url,
            description: 'URL of the API Gateway',
        });
        new cdk.CfnOutput(this, 'LoadBalancerDns', {
            value: lb.loadBalancerDnsName,
            description: 'DNS Name of the Load Balancer',
        });
        new cdk.CfnOutput(this, 'EcrRepositoryUri', {
            value: ecrRepo.repositoryUri,
            description: 'URI of the ECR Repository',
        });
    }
}
exports.InfraStack = InfraStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mcmEtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmZyYS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUVuQyx5REFBMkM7QUFDM0MseURBQTJDO0FBQzNDLHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MsdUVBQXlEO0FBQ3pELHFFQUF1RDtBQUN2RCwyRUFBNkQ7QUFDN0QsMkZBQTZFO0FBQzdFLDJEQUE2QztBQUM3Qyw4RUFBZ0U7QUFFaEUsTUFBYSxVQUFXLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDdkMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixpQkFBaUI7UUFDakIsTUFBTSxPQUFPLEdBQUcsSUFBSSxHQUFHLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDckQsY0FBYyxFQUFFLFVBQVU7WUFDMUIsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTztZQUN4QyxnQkFBZ0IsRUFBRSxJQUFJO1NBQ3ZCLENBQUMsQ0FBQztRQUVILGtCQUFrQjtRQUNsQixNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRTtZQUN0QyxNQUFNLEVBQUUsQ0FBQztZQUNULFdBQVcsRUFBRSxDQUFDO1NBQ2YsQ0FBQyxDQUFDO1FBRUgsY0FBYztRQUNkLE1BQU0sT0FBTyxHQUFHLElBQUksR0FBRyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQ2xELEdBQUc7WUFDSCxXQUFXLEVBQUUsYUFBYTtTQUMzQixDQUFDLENBQUM7UUFFSCxrQkFBa0I7UUFDbEIsTUFBTSxjQUFjLEdBQUcsSUFBSSxHQUFHLENBQUMscUJBQXFCLENBQUMsSUFBSSxF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LEVBQUUsY0FBYztvQkFDckIsSUFBSSxFQUFFLGtCQUFrQjtvQkFDeEIsTUFBTSxFQUFFLE1BQU07b0JBQ2QsYUFBYSxFQUFFLG1HQUFtRztvQkFDbEgsTUFBTSxFQUFFLFlBQVk7aUJBQ3JCLENBQUM7YUFDSDtTQUNGLENBQUMsQ0FBQztRQUVILGNBQWM7UUFDZCxRQUFRLENBQUMsUUFBUSxDQUFDO1lBQ2hCLFNBQVMsRUFBRSxPQUFPO1lBQ2xCLE9BQU8sRUFBRTtnQkFDUCxJQUFJLG9CQUFvQixDQUFDLGVBQWUsQ0FBQztvQkFDdkMsVUFBVSxFQUFFLGNBQWM7b0JBQzFCLE9BQU8sRUFBRSxZQUFZO29CQUNyQixLQUFLLEVBQUUsWUFBWTtvQkFDbkIsT0FBTyxFQUFFLENBQUMsV0FBVyxDQUFDO2lCQUN2QixDQUFDO2FBQ0g7U0FDRixDQUFDLENBQUM7UUFFSCxVQUFVO1FBQ1YsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdkMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxHQUFHO1lBQ2QsV0FBVyxFQUFFLHdCQUF3QjtTQUN0QyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQ3pDLEtBQUssRUFBRSxFQUFFLENBQUMsbUJBQW1CO1lBQzdCLFdBQVcsRUFBRSwrQkFBK0I7U0FDN0MsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsT0FBTyxDQUFDLGFBQWE7WUFDNUIsV0FBVyxFQUFFLDJCQUEyQjtTQUN6QyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFoT0QsZ0NBZ09DIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgZWNyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3InO1xuaW1wb3J0ICogYXMgZWNzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MnO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XG5pbXBvcnQgKiBhcyBjb2RlYnVpbGQgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVidWlsZCc7XG5pbXBvcnQgKiBhcyBjb2RlcGlwZWxpbmUgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVwaXBlbGluZSc7XG5pbXBvcnQgKiBhcyBjb2RlcGlwZWxpbmVfYWN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29kZXBpcGVsaW5lLWFjdGlvbnMnO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBlbGJ2MiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWxhc3RpY2xvYWRiYWxhbmNpbmd2Mic7XG5cbmV4cG9ydCBjbGFzcyBJbmZyYVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gRUNSIFJlcG9zaXRvcnlcbiAgICBjb25zdCBlY3JSZXBvID0gbmV3IGVjci5SZXBvc2l0b3J5KHRoaXMsICdBbWFFY3JSZXBvJywge1xuICAgICAgcmVwb3NpdG9yeU5hbWU6ICdhbWEtZGVtbycsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgYXV0b0RlbGV0ZUltYWdlczogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIFZQQyBmb3IgRmFyZ2F0ZVxuICAgIGNvbnN0IHZwYyA9IG5ldyBlYzIuVnBjKHRoaXMsICdBbWFWcGMnLCB7XG4gICAgICBtYXhBenM6IDIsXG4gICAgICBuYXRHYXRld2F5czogMSxcbiAgICB9KTtcblxuICAgIC8vIEVDUyBDbHVzdGVyXG4gICAgY29uc3QgY2x1c3RlciA9IG5ldyBlY3MuQ2x1c3Rlcih0aGlzLCAnQW1hQ2x1c3RlcicsIHtcbiAgICAgIHZwYyxcbiAgICAgIGNsdXN0ZXJOYW1lOiAnYW1hLWNsdXN0ZXInLFxuICAgIH0pO1xuXG4gICAgLy8gVGFzayBEZWZpbml0aW9uXG4gICAgY29uc3QgdGFza0RlZmluaXRpb24gPSBuZXcgZWNzLkZhcmdhdGVUYXNrRGVmaW5pdGlvbih0aGlzLCAnQW1hVGFza0RlZicsIHtcbiAgICAgIG1lbW9yeUxpbWl0TWlCOiA1MTIsXG4gICAgICBjcHU6IDI1NixcbiAgICB9KTtcblxuICAgIC8vIEFkZCBjb250YWluZXIgdG8gdGFzayBkZWZpbml0aW9uXG4gICAgY29uc3QgY29udGFpbmVyTmFtZSA9ICdhbWEtZGVtbyc7XG4gICAgY29uc3QgY29udGFpbmVyID0gdGFza0RlZmluaXRpb24uYWRkQ29udGFpbmVyKGNvbnRhaW5lck5hbWUsIHtcbiAgICAgIGltYWdlOiBlY3MuQ29udGFpbmVySW1hZ2UuZnJvbUVjclJlcG9zaXRvcnkoZWNyUmVwbyksXG4gICAgICBsb2dnaW5nOiBlY3MuTG9nRHJpdmVycy5hd3NMb2dzKHtcbiAgICAgICAgc3RyZWFtUHJlZml4OiAnYW1hLWRlbW8nLFxuICAgICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgIH0pLFxuICAgICAgcG9ydE1hcHBpbmdzOiBbeyBjb250YWluZXJQb3J0OiA4MDgwIH1dLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIGEgc2VjdXJpdHkgZ3JvdXAgZm9yIHRoZSBsb2FkIGJhbGFuY2VyXG4gICAgY29uc3QgbGJTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdMQlNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGMsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlY3VyaXR5IGdyb3VwIGZvciB0aGUgbG9hZCBiYWxhbmNlcicsXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiB0cnVlLFxuICAgIH0pO1xuICAgIGxiU2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShlYzIuUGVlci5hbnlJcHY0KCksIGVjMi5Qb3J0LnRjcCg4MCksICdBbGxvdyBIVFRQIHRyYWZmaWMnKTtcblxuICAgIC8vIENyZWF0ZSBhIHNlY3VyaXR5IGdyb3VwIGZvciB0aGUgRmFyZ2F0ZSBzZXJ2aWNlXG4gICAgY29uc3Qgc2VydmljZVNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ1NlcnZpY2VTZWN1cml0eUdyb3VwJywge1xuICAgICAgdnBjLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgdGhlIEZhcmdhdGUgc2VydmljZScsXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiB0cnVlLFxuICAgIH0pO1xuICAgIHNlcnZpY2VTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKGxiU2VjdXJpdHlHcm91cCwgZWMyLlBvcnQudGNwKDgwODApLCAnQWxsb3cgdHJhZmZpYyBmcm9tIExCJyk7XG5cbiAgICAvLyBDcmVhdGUgYSBOZXR3b3JrIExvYWQgQmFsYW5jZXIgKHJlcXVpcmVkIGZvciBWUEMgTGluaylcbiAgICBjb25zdCBsYiA9IG5ldyBlbGJ2Mi5OZXR3b3JrTG9hZEJhbGFuY2VyKHRoaXMsICdBbWFMb2FkQmFsYW5jZXInLCB7XG4gICAgICB2cGMsXG4gICAgICBpbnRlcm5ldEZhY2luZzogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBhIGxpc3RlbmVyIHRvIHRoZSBsb2FkIGJhbGFuY2VyXG4gICAgY29uc3QgbGlzdGVuZXIgPSBsYi5hZGRMaXN0ZW5lcignTGlzdGVuZXInLCB7XG4gICAgICBwb3J0OiA4MCxcbiAgICB9KTtcblxuICAgIC8vIEZhcmdhdGUgU2VydmljZVxuICAgIGNvbnN0IGZhcmdhdGVTZXJ2aWNlID0gbmV3IGVjcy5GYXJnYXRlU2VydmljZSh0aGlzLCAnQW1hU2VydmljZScsIHtcbiAgICAgIGNsdXN0ZXIsXG4gICAgICB0YXNrRGVmaW5pdGlvbixcbiAgICAgIGRlc2lyZWRDb3VudDogMSxcbiAgICAgIGFzc2lnblB1YmxpY0lwOiBmYWxzZSwgLy8gVXNpbmcgcHJpdmF0ZSBzdWJuZXRzIHdpdGggTkFUIGdhdGV3YXlcbiAgICAgIHNlcnZpY2VOYW1lOiAnYW1hLXNlcnZpY2UnLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtzZXJ2aWNlU2VjdXJpdHlHcm91cF0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgdGhlIEZhcmdhdGUgc2VydmljZSBhcyBhIHRhcmdldCB0byB0aGUgbG9hZCBiYWxhbmNlclxuICAgIGxpc3RlbmVyLmFkZFRhcmdldHMoJ0ZhcmdhdGVUYXJnZXQnLCB7XG4gICAgICBwb3J0OiA4MDgwLFxuICAgICAgdGFyZ2V0czogW2ZhcmdhdGVTZXJ2aWNlXSxcbiAgICAgIGhlYWx0aENoZWNrOiB7XG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIGhlYWx0aHlUaHJlc2hvbGRDb3VudDogMixcbiAgICAgICAgdW5oZWFsdGh5VGhyZXNob2xkQ291bnQ6IDIsXG4gICAgICAgIGludGVydmFsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygxMCksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQVBJIEdhdGV3YXlcbiAgICBjb25zdCBhcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsICdBbWFHYXRld2F5Jywge1xuICAgICAgcmVzdEFwaU5hbWU6ICdhbWEtZ2F0ZXdheTEnLFxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgR2F0ZXdheSBmb3IgQU1BIERlbW8nLFxuICAgICAgZGVwbG95T3B0aW9uczoge1xuICAgICAgICBzdGFnZU5hbWU6ICdwcm9kJyxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgYSBWUEMgTGluayBmb3IgQVBJIEdhdGV3YXkgdG8gYWNjZXNzIHRoZSBOZXR3b3JrIExvYWQgQmFsYW5jZXJcbiAgICBjb25zdCB2cGNMaW5rID0gbmV3IGFwaWdhdGV3YXkuVnBjTGluayh0aGlzLCAnQW1hVnBjTGluaycsIHtcbiAgICAgIHRhcmdldHM6IFtsYl0sXG4gICAgfSk7XG5cbiAgICAvLyBJbnRlZ3JhdGlvbiBiZXR3ZWVuIEFQSSBHYXRld2F5IGFuZCBOTEJcbiAgICBjb25zdCBpbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkludGVncmF0aW9uKHtcbiAgICAgIHR5cGU6IGFwaWdhdGV3YXkuSW50ZWdyYXRpb25UeXBlLkhUVFBfUFJPWFksXG4gICAgICBpbnRlZ3JhdGlvbkh0dHBNZXRob2Q6ICdBTlknLFxuICAgICAgdXJpOiBgaHR0cDovLyR7bGIubG9hZEJhbGFuY2VyRG5zTmFtZX0vYCxcbiAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgY29ubmVjdGlvblR5cGU6IGFwaWdhdGV3YXkuQ29ubmVjdGlvblR5cGUuVlBDX0xJTkssXG4gICAgICAgIHZwY0xpbmssXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIHJvb3QgcmVzb3VyY2Ugd2l0aCBBTlkgbWV0aG9kXG4gICAgYXBpLnJvb3QuYWRkTWV0aG9kKCdBTlknLCBpbnRlZ3JhdGlvbik7XG5cbiAgICAvLyBDb2RlQnVpbGQgUHJvamVjdFxuICAgIGNvbnN0IGJ1aWxkUHJvamVjdCA9IG5ldyBjb2RlYnVpbGQuUGlwZWxpbmVQcm9qZWN0KHRoaXMsICdBbWFCdWlsZFByb2plY3QnLCB7XG4gICAgICBwcm9qZWN0TmFtZTogJ2FtYS1idWlsZCcsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBidWlsZEltYWdlOiBjb2RlYnVpbGQuTGludXhCdWlsZEltYWdlLkFNQVpPTl9MSU5VWF8yXzMsXG4gICAgICAgIHByaXZpbGVnZWQ6IHRydWUsIC8vIFJlcXVpcmVkIGZvciBEb2NrZXIgYnVpbGRzXG4gICAgICB9LFxuICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgUkVQT1NJVE9SWV9VUkk6IHtcbiAgICAgICAgICB2YWx1ZTogZWNyUmVwby5yZXBvc2l0b3J5VXJpLFxuICAgICAgICB9LFxuICAgICAgICBDT05UQUlORVJfTkFNRToge1xuICAgICAgICAgIHZhbHVlOiBjb250YWluZXJOYW1lLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGJ1aWxkU3BlYzogY29kZWJ1aWxkLkJ1aWxkU3BlYy5mcm9tT2JqZWN0KHtcbiAgICAgICAgdmVyc2lvbjogJzAuMicsXG4gICAgICAgIHBoYXNlczoge1xuICAgICAgICAgIHByZV9idWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ2VjaG8gTG9nZ2luZyBpbiB0byBBbWF6b24gRUNSLi4uJyxcbiAgICAgICAgICAgICAgJ2F3cyBlY3IgZ2V0LWxvZ2luLXBhc3N3b3JkIC0tcmVnaW9uICRBV1NfREVGQVVMVF9SRUdJT04gfCBkb2NrZXIgbG9naW4gLS11c2VybmFtZSBBV1MgLS1wYXNzd29yZC1zdGRpbiAkUkVQT1NJVE9SWV9VUkknLFxuICAgICAgICAgICAgICAnQ09NTUlUX0hBU0g9JChlY2hvICRDT0RFQlVJTERfUkVTT0xWRURfU09VUkNFX1ZFUlNJT04gfCBjdXQgLWMgMS03KScsXG4gICAgICAgICAgICAgICdJTUFHRV9UQUc9JHtDT01NSVRfSEFTSDo9bGF0ZXN0fScsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgYnVpbGQ6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAgICdlY2hvIEJ1aWxkaW5nIHRoZSBEb2NrZXIgaW1hZ2UuLi4nLFxuICAgICAgICAgICAgICAnY2QgYXBwJyxcbiAgICAgICAgICAgICAgJ2RvY2tlciBidWlsZCAtdCAkUkVQT1NJVE9SWV9VUkk6bGF0ZXN0IC4nLFxuICAgICAgICAgICAgICAnZG9ja2VyIHRhZyAkUkVQT1NJVE9SWV9VUkk6bGF0ZXN0ICRSRVBPU0lUT1JZX1VSSTokSU1BR0VfVEFHJyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwb3N0X2J1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnZWNobyBQdXNoaW5nIHRoZSBEb2NrZXIgaW1hZ2UuLi4nLFxuICAgICAgICAgICAgICAnZG9ja2VyIHB1c2ggJFJFUE9TSVRPUllfVVJJOmxhdGVzdCcsXG4gICAgICAgICAgICAgICdkb2NrZXIgcHVzaCAkUkVQT1NJVE9SWV9VUkk6JElNQUdFX1RBRycsXG4gICAgICAgICAgICAgICdlY2hvIFdyaXRpbmcgaW1hZ2UgZGVmaW5pdGlvbnMgZmlsZS4uLicsXG4gICAgICAgICAgICAgICdhd3MgZWNzIHVwZGF0ZS1zZXJ2aWNlIC0tY2x1c3RlciBhbWEtY2x1c3RlciAtLXNlcnZpY2UgYW1hLXNlcnZpY2UgLS1mb3JjZS1uZXctZGVwbG95bWVudCcsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIHRvIENvZGVCdWlsZFxuICAgIGVjclJlcG8uZ3JhbnRQdWxsUHVzaChidWlsZFByb2plY3Qucm9sZSEpO1xuICAgIGJ1aWxkUHJvamVjdC5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydlY3M6VXBkYXRlU2VydmljZSddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBDb2RlUGlwZWxpbmVcbiAgICBjb25zdCBzb3VyY2VPdXRwdXQgPSBuZXcgY29kZXBpcGVsaW5lLkFydGlmYWN0KCk7XG4gICAgY29uc3QgYnVpbGRPdXRwdXQgPSBuZXcgY29kZXBpcGVsaW5lLkFydGlmYWN0KCk7XG5cbiAgICBjb25zdCBwaXBlbGluZSA9IG5ldyBjb2RlcGlwZWxpbmUuUGlwZWxpbmUodGhpcywgJ0FtYVBpcGVsaW5lJywge1xuICAgICAgcGlwZWxpbmVOYW1lOiAnYW1hLXBpcGVsaW5lJyxcbiAgICAgIHJlc3RhcnRFeGVjdXRpb25PblVwZGF0ZTogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIFNvdXJjZSBTdGFnZVxuICAgIHBpcGVsaW5lLmFkZFN0YWdlKHtcbiAgICAgIHN0YWdlTmFtZTogJ1NvdXJjZScsXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgIG5ldyBjb2RlcGlwZWxpbmVfYWN0aW9ucy5Db2RlU3RhckNvbm5lY3Rpb25zU291cmNlQWN0aW9uKHtcbiAgICAgICAgICBhY3Rpb25OYW1lOiAnR2l0SHViX1NvdXJjZScsXG4gICAgICAgICAgb3duZXI6ICdicmVudGdmb3hhd3MnLFxuICAgICAgICAgIHJlcG86ICdhbWEtY29kZXBpcGVsaW5lJyxcbiAgICAgICAgICBicmFuY2g6ICdtYWluJyxcbiAgICAgICAgICBjb25uZWN0aW9uQXJuOiAnYXJuOmF3czpjb2RlY29ubmVjdGlvbnM6Y2EtY2VudHJhbC0xOjU4MjgyODMxODAwODpjb25uZWN0aW9uL2FkYmI4ZjYzLWNmZTEtNDNkZS1iN2MyLTA1ZWNmMjNlMjFiNycsXG4gICAgICAgICAgb3V0cHV0OiBzb3VyY2VPdXRwdXQsXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIEJ1aWxkIFN0YWdlXG4gICAgcGlwZWxpbmUuYWRkU3RhZ2Uoe1xuICAgICAgc3RhZ2VOYW1lOiAnQnVpbGQnLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICBuZXcgY29kZXBpcGVsaW5lX2FjdGlvbnMuQ29kZUJ1aWxkQWN0aW9uKHtcbiAgICAgICAgICBhY3Rpb25OYW1lOiAnQnVpbGRBbmRQdXNoJyxcbiAgICAgICAgICBwcm9qZWN0OiBidWlsZFByb2plY3QsXG4gICAgICAgICAgaW5wdXQ6IHNvdXJjZU91dHB1dCxcbiAgICAgICAgICBvdXRwdXRzOiBbYnVpbGRPdXRwdXRdLFxuICAgICAgICB9KSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBPdXRwdXRzXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwaUdhdGV3YXlVcmwnLCB7XG4gICAgICB2YWx1ZTogYXBpLnVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVVJMIG9mIHRoZSBBUEkgR2F0ZXdheScsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTG9hZEJhbGFuY2VyRG5zJywge1xuICAgICAgdmFsdWU6IGxiLmxvYWRCYWxhbmNlckRuc05hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0ROUyBOYW1lIG9mIHRoZSBMb2FkIEJhbGFuY2VyJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdFY3JSZXBvc2l0b3J5VXJpJywge1xuICAgICAgdmFsdWU6IGVjclJlcG8ucmVwb3NpdG9yeVVyaSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVVJJIG9mIHRoZSBFQ1IgUmVwb3NpdG9yeScsXG4gICAgfSk7XG4gIH1cbn0iXX0=