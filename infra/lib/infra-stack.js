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
        const lb = new elbv2.NetworkLoadBalancer(this, 'CodepipelineDemoLoadBalancer', {
            vpc,
            internetFacing: true,
        });
        // Add a listener to the load balancer
        const listener = lb.addListener('Listener', {
            port: 80,
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
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 2,
                interval: cdk.Duration.seconds(10),
            },
        });
        // API Gateway
        const api = new apigateway.RestApi(this, 'CodepipelineDemoGateway', {
            restApiName: 'codepipeline-demo-gateway',
            description: 'API Gateway for CodePipeline Demo',
            deployOptions: {
                stageName: 'prod',
            },
        });
        // Create a VPC Link for API Gateway to access the Network Load Balancer
        const vpcLink = new apigateway.VpcLink(this, 'CodepipelineDemoVpcLink', {
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
                    owner: 'brentgfoxaws',
                    repo: 'codepipeline-demo',
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mcmEtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmZyYS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUVuQyx5REFBMkM7QUFDM0MseURBQTJDO0FBQzNDLHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MsdUVBQXlEO0FBQ3pELHFFQUF1RDtBQUN2RCwyRUFBNkQ7QUFDN0QsMkZBQTZFO0FBQzdFLDJEQUE2QztBQUM3Qyw4RUFBZ0U7QUFFaEUsTUFBYSxVQUFXLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDdkMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixpQkFBaUI7UUFDakIsTUFBTSxPQUFPLEdBQUcsSUFBSSxHQUFHLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSx5QkFBeUIsRUFBRTtZQUNsRSxjQUFjLEVBQUUsbUJBQW1CO1lBQ25DLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87WUFDeEMsYUFBYSxFQUFFLElBQUksRUFBRSw2REFBNkQ7U0FDbkYsQ0FBQyxDQUFDO1FBRUgsa0JBQWtCO1FBQ2xCLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7WUFDbkQsTUFBTSxFQUFFLENBQUM7WUFDVCxXQUFXLEVBQUUsQ0FBQztTQUNmLENBQUMsQ0FBQztRQUVILGNBQWM7UUFDZCxNQUFNLE9BQU8sR0FBRyxJQUFJLEdBQUcsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLHlCQUF5QixFQUFFO1lBQy9ELEdBQUc7WUFDSCxXQUFXLEVBQUUsMkJBQTJCO1NBQ3pDLENBQUMsQ0FBQztRQUVILGtCQUFrQjtRQUNsQixNQUFNLGNBQWMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxxQkFBcUIsQ0FBQyxJQUFJLEVBQUUseUJBQXlCLEVBQUU7WUFDcEYsY0FBYyxFQUFFLEdBQUc7WUFDbkIsR0FBRyxFQUFFLEdBQUc7U0FDVCxDQUFDLENBQUM7UUFFSCxtQ0FBbUM7UUFDbkMsTUFBTSxhQUFhLEdBQUcsbUJBQW1CLENBQUM7UUFDMUMsTUFBTSxTQUFTLEdBQUcsY0FBYyxDQUFDLFlBQVksQ0FBQyxhQUFhLEVBQUU7WUFDM0QsS0FBSyxFQUFFLEdBQUcsQ0FBQyxjQUFjLENBQUMsaUJBQWlCLENBQUMsT0FBTyxDQUFDO1lBQ3BELE9BQU8sRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQztnQkFDOUIsWUFBWSxFQUFFLG1CQUFtQjtnQkFDakMsWUFBWSxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUTthQUMxQyxDQUFDO1lBQ0YsWUFBWSxFQUFFLENBQUMsRUFBRSxhQUFhLEVBQUUsSUFBSSxFQUFFLENBQUM7U0FDeEMsQ0FBQyxDQUFDO1FBRUgsZ0RBQWdEO1FBQ2hELE1BQU0sZUFBZSxHQUFHLElBQUksR0FBRyxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDckUsR0FBRztZQUNILFdBQVcsRUFBRSxzQ0FBc0M7WUFDbkQsZ0JBQWdCLEVBQUUsSUFBSTtTQUN2QixDQUFDLENBQUM7UUFDSCxlQUFlLENBQUMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztRQUUzRixrREFBa0Q7UUFDbEQsTUFBTSxvQkFBb0IsR0FBRyxJQUFJLEdBQUcsQ0FBQyxhQUFhLENBQUMsSUFBSSxFQUFFLHNCQUFzQixFQUFFO1lBQy9FLEdBQUc7WUFDSCxXQUFXLEVBQUUsd0NBQXdDO1lBQ3JELGdCQUFnQixFQUFFLElBQUk7U0FDdkIsQ0FBQyxDQUFDO1FBQ0gsb0JBQW9CLENBQUMsY0FBYyxDQUFDLGVBQWUsRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSx1QkFBdUIsQ0FBQyxDQUFDO1FBRWxHLHlEQUF5RDtRQUN6RCxNQUFNLEVBQUUsR0FBRyxJQUFJLEtBQUssQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLEVBQUUsOEJBQThCLEVBQUU7WUFDN0UsR0FBRztZQUNILGNBQWMsRUFBRSxJQUFJO1NBQ3JCLENBQUMsQ0FBQztRQUVILHNDQUFzQztRQUN0QyxNQUFNLFFBQVEsR0FBRyxFQUFFLENBQUMsV0FBVyxDQUFDLFVBQVUsRUFBRTtZQUMxQyxJQUFJLEVBQUUsRUFBRTtTQUNULENBQUMsQ0FBQztRQUVILGtCQUFrQjtRQUNsQixNQUFNLGNBQWMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLHlCQUF5QixFQUFFO1lBQzdFLE9BQU87WUFDUCxjQUFjO1lBQ2QsWUFBWSxFQUFFLENBQUM7WUFDZixjQUFjLEVBQUUsS0FBSyxFQUFFLHlDQUF5QztZQUNoRSxXQUFXLEVBQUUsMkJBQTJCO1lBQ3hDLGNBQWMsRUFBRSxDQUFDLG9CQUFvQixDQUFDO1NBQ3ZDLENBQUMsQ0FBQztRQUVILDJEQUEyRDtRQUMzRCxRQUFRLENBQUMsVUFBVSxDQUFDLGVBQWUsRUFBRTtZQUNuQyxJQUFJLEVBQUUsSUFBSTtZQUNWLE9BQU8sRUFBRSxDQUFDLGNBQWMsQ0FBQztZQUN6QixXQUFXLEVBQUU7Z0JBQ1gsT0FBTyxFQUFFLElBQUk7Z0JBQ2IscUJBQXFCLEVBQUUsQ0FBQztnQkFDeEIsdUJBQXVCLEVBQUUsQ0FBQztnQkFDMUIsUUFBUSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQzthQUNuQztTQUNGLENBQUMsQ0FBQztRQUVILGNBQWM7UUFDZCxNQUFNLEdBQUcsR0FBRyxJQUFJLFVBQVUsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLHlCQUF5QixFQUFFO1lBQ2xFLFdBQVcsRUFBRSwyQkFBMkI7WUFDeEMsV0FBVyxFQUFFLG1DQUFtQztZQUNoRCxhQUFhLEVBQUU7Z0JBQ2IsU0FBUyxFQUFFLE1BQU07YUFDbEI7U0FDRixDQUFDLENBQUM7UUFFSCx3RUFBd0U7UUFDeEUsTUFBTSxPQUFPLEdBQUcsSUFBSSxVQUFVLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSx5QkFBeUIsRUFBRTtZQUN0RSxPQUFPLEVBQUUsQ0FBQyxFQUFFLENBQUM7U0FDZCxDQUFDLENBQUM7UUFFSCwwQ0FBMEM7UUFDMUMsTUFBTSxXQUFXLEdBQUcsSUFBSSxVQUFVLENBQUMsV0FBVyxDQUFDO1lBQzdDLElBQUksRUFBRSxVQUFVLENBQUMsZUFBZSxDQUFDLFVBQVU7WUFDM0MscUJBQXFCLEVBQUUsS0FBSztZQUM1QixHQUFHLEVBQUUsVUFBVSxFQUFFLENBQUMsbUJBQW1CLEdBQUc7WUFDeEMsT0FBTyxFQUFFO2dCQUNQLGNBQWMsRUFBRSxVQUFVLENBQUMsY0FBYyxDQUFDLFFBQVE7Z0JBQ2xELE9BQU87YUFDUjtTQUNGLENBQUMsQ0FBQztRQUVILG9DQUFvQztRQUNwQyxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsV0FBVyxDQUFDLENBQUM7UUFFdkMsb0JBQW9CO1FBQ3BCLE1BQU0sWUFBWSxHQUFHLElBQUksU0FBUyxDQUFDLGVBQWUsQ0FBQyxJQUFJLEVBQUUsOEJBQThCLEVBQUU7WUFDdkYsV0FBVyxFQUFFLHlCQUF5QjtZQUN0QyxXQUFXLEVBQUU7Z0JBQ1gsVUFBVSxFQUFFLFNBQVMsQ0FBQyxlQUFlLENBQUMsZ0JBQWdCO2dCQUN0RCxVQUFVLEVBQUUsSUFBSSxFQUFFLDZCQUE2QjthQUNoRDtZQUNELG9CQUFvQixFQUFFO2dCQUNwQixjQUFjLEVBQUU7b0JBQ2QsS0FBSyxFQUFFLE9BQU8sQ0FBQyxhQUFhO2lCQUM3QjtnQkFDRCxjQUFjLEVBQUU7b0JBQ2QsS0FBSyxFQUFFLGFBQWE7aUJBQ3JCO2FBQ0Y7WUFDRCxTQUFTLEVBQUUsU0FBUyxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUM7Z0JBQ3hDLE9BQU8sRUFBRSxLQUFLO2dCQUNkLE1BQU0sRUFBRTtvQkFDTixTQUFTLEVBQUU7d0JBQ1QsUUFBUSxFQUFFOzRCQUNSLGtDQUFrQzs0QkFDbEMsd0hBQXdIOzRCQUN4SCxxRUFBcUU7NEJBQ3JFLGtDQUFrQzt5QkFDbkM7cUJBQ0Y7b0JBQ0QsS0FBSyxFQUFFO3dCQUNMLFFBQVEsRUFBRTs0QkFDUixtQ0FBbUM7NEJBQ25DLFFBQVE7NEJBQ1IsMENBQTBDOzRCQUMxQyw4REFBOEQ7eUJBQy9EO3FCQUNGO29CQUNELFVBQVUsRUFBRTt3QkFDVixRQUFRLEVBQUU7NEJBQ1Isa0NBQWtDOzRCQUNsQyxvQ0FBb0M7NEJBQ3BDLHdDQUF3Qzs0QkFDeEMsd0NBQXdDOzRCQUN4Qyx1SEFBdUg7eUJBQ3hIO3FCQUNGO2lCQUNGO2FBQ0YsQ0FBQztTQUNILENBQUMsQ0FBQztRQUVILGlDQUFpQztRQUNqQyxPQUFPLENBQUMsYUFBYSxDQUFDLFlBQVksQ0FBQyxJQUFLLENBQUMsQ0FBQztRQUMxQyxZQUFZLENBQUMsZUFBZSxDQUFDLElBQUksR0FBRyxDQUFDLGVBQWUsQ0FBQztZQUNuRCxPQUFPLEVBQUUsQ0FBQyxtQkFBbUIsQ0FBQztZQUM5QixTQUFTLEVBQUUsQ0FBQyxHQUFHLENBQUM7U0FDakIsQ0FBQyxDQUFDLENBQUM7UUFFSixlQUFlO1FBQ2YsTUFBTSxZQUFZLEdBQUcsSUFBSSxZQUFZLENBQUMsUUFBUSxFQUFFLENBQUM7UUFDakQsTUFBTSxXQUFXLEdBQUcsSUFBSSxZQUFZLENBQUMsUUFBUSxFQUFFLENBQUM7UUFFaEQsTUFBTSxRQUFRLEdBQUcsSUFBSSxZQUFZLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSwwQkFBMEIsRUFBRTtZQUMzRSxZQUFZLEVBQUUsNEJBQTRCO1lBQzFDLHdCQUF3QixFQUFFLElBQUk7U0FDL0IsQ0FBQyxDQUFDO1FBRUgsZUFBZTtRQUNmLFFBQVEsQ0FBQyxRQUFRLENBQUM7WUFDaEIsU0FBUyxFQUFFLFFBQVE7WUFDbkIsT0FBTyxFQUFFO2dCQUNQLElBQUksb0JBQW9CLENBQUMsK0JBQStCLENBQUM7b0JBQ3ZELFVBQVUsRUFBRSxlQUFlO29CQUMzQixLQUFLLEVBQUUsY0FBYztvQkFDckIsSUFBSSxFQUFFLG1CQUFtQjtvQkFDekIsTUFBTSxFQUFFLE1BQU07b0JBQ2QsYUFBYSxFQUFFLG1HQUFtRztvQkFDbEgsTUFBTSxFQUFFLFlBQVk7aUJBQ3JCLENBQUM7YUFDSDtTQUNGLENBQUMsQ0FBQztRQUVILGNBQWM7UUFDZCxRQUFRLENBQUMsUUFBUSxDQUFDO1lBQ2hCLFNBQVMsRUFBRSxPQUFPO1lBQ2xCLE9BQU8sRUFBRTtnQkFDUCxJQUFJLG9CQUFvQixDQUFDLGVBQWUsQ0FBQztvQkFDdkMsVUFBVSxFQUFFLGNBQWM7b0JBQzFCLE9BQU8sRUFBRSxZQUFZO29CQUNyQixLQUFLLEVBQUUsWUFBWTtvQkFDbkIsT0FBTyxFQUFFLENBQUMsV0FBVyxDQUFDO2lCQUN2QixDQUFDO2FBQ0g7U0FDRixDQUFDLENBQUM7UUFFSCxVQUFVO1FBQ1YsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdkMsS0FBSyxFQUFFLEdBQUcsQ0FBQyxHQUFHO1lBQ2QsV0FBVyxFQUFFLHdCQUF3QjtTQUN0QyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQ3pDLEtBQUssRUFBRSxFQUFFLENBQUMsbUJBQW1CO1lBQzdCLFdBQVcsRUFBRSwrQkFBK0I7U0FDN0MsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsT0FBTyxDQUFDLGFBQWE7WUFDNUIsV0FBVyxFQUFFLDJCQUEyQjtTQUN6QyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFoT0QsZ0NBZ09DIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgZWNyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3InO1xuaW1wb3J0ICogYXMgZWNzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MnO1xuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XG5pbXBvcnQgKiBhcyBjb2RlYnVpbGQgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVidWlsZCc7XG5pbXBvcnQgKiBhcyBjb2RlcGlwZWxpbmUgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVwaXBlbGluZSc7XG5pbXBvcnQgKiBhcyBjb2RlcGlwZWxpbmVfYWN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29kZXBpcGVsaW5lLWFjdGlvbnMnO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBlbGJ2MiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWxhc3RpY2xvYWRiYWxhbmNpbmd2Mic7XG5cbmV4cG9ydCBjbGFzcyBJbmZyYVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gRUNSIFJlcG9zaXRvcnlcbiAgICBjb25zdCBlY3JSZXBvID0gbmV3IGVjci5SZXBvc2l0b3J5KHRoaXMsICdDb2RlcGlwZWxpbmVEZW1vRWNyUmVwbycsIHtcbiAgICAgIHJlcG9zaXRvcnlOYW1lOiAnY29kZXBpcGVsaW5lLWRlbW8nLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGVtcHR5T25EZWxldGU6IHRydWUsIC8vIFVzaW5nIGVtcHR5T25EZWxldGUgaW5zdGVhZCBvZiBkZXByZWNhdGVkIGF1dG9EZWxldGVJbWFnZXNcbiAgICB9KTtcblxuICAgIC8vIFZQQyBmb3IgRmFyZ2F0ZVxuICAgIGNvbnN0IHZwYyA9IG5ldyBlYzIuVnBjKHRoaXMsICdDb2RlcGlwZWxpbmVEZW1vVnBjJywge1xuICAgICAgbWF4QXpzOiAyLFxuICAgICAgbmF0R2F0ZXdheXM6IDEsXG4gICAgfSk7XG5cbiAgICAvLyBFQ1MgQ2x1c3RlclxuICAgIGNvbnN0IGNsdXN0ZXIgPSBuZXcgZWNzLkNsdXN0ZXIodGhpcywgJ0NvZGVwaXBlbGluZURlbW9DbHVzdGVyJywge1xuICAgICAgdnBjLFxuICAgICAgY2x1c3Rlck5hbWU6ICdjb2RlcGlwZWxpbmUtZGVtby1jbHVzdGVyJyxcbiAgICB9KTtcblxuICAgIC8vIFRhc2sgRGVmaW5pdGlvblxuICAgIGNvbnN0IHRhc2tEZWZpbml0aW9uID0gbmV3IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb24odGhpcywgJ0NvZGVwaXBlbGluZURlbW9UYXNrRGVmJywge1xuICAgICAgbWVtb3J5TGltaXRNaUI6IDUxMixcbiAgICAgIGNwdTogMjU2LFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIGNvbnRhaW5lciB0byB0YXNrIGRlZmluaXRpb25cbiAgICBjb25zdCBjb250YWluZXJOYW1lID0gJ2NvZGVwaXBlbGluZS1kZW1vJztcbiAgICBjb25zdCBjb250YWluZXIgPSB0YXNrRGVmaW5pdGlvbi5hZGRDb250YWluZXIoY29udGFpbmVyTmFtZSwge1xuICAgICAgaW1hZ2U6IGVjcy5Db250YWluZXJJbWFnZS5mcm9tRWNyUmVwb3NpdG9yeShlY3JSZXBvKSxcbiAgICAgIGxvZ2dpbmc6IGVjcy5Mb2dEcml2ZXJzLmF3c0xvZ3Moe1xuICAgICAgICBzdHJlYW1QcmVmaXg6ICdjb2RlcGlwZWxpbmUtZGVtbycsXG4gICAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgfSksXG4gICAgICBwb3J0TWFwcGluZ3M6IFt7IGNvbnRhaW5lclBvcnQ6IDgwODAgfV0sXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgYSBzZWN1cml0eSBncm91cCBmb3IgdGhlIGxvYWQgYmFsYW5jZXJcbiAgICBjb25zdCBsYlNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0xCU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIHZwYyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgZ3JvdXAgZm9yIHRoZSBsb2FkIGJhbGFuY2VyJyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IHRydWUsXG4gICAgfSk7XG4gICAgbGJTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKGVjMi5QZWVyLmFueUlwdjQoKSwgZWMyLlBvcnQudGNwKDgwKSwgJ0FsbG93IEhUVFAgdHJhZmZpYycpO1xuXG4gICAgLy8gQ3JlYXRlIGEgc2VjdXJpdHkgZ3JvdXAgZm9yIHRoZSBGYXJnYXRlIHNlcnZpY2VcbiAgICBjb25zdCBzZXJ2aWNlU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnU2VydmljZVNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGMsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlY3VyaXR5IGdyb3VwIGZvciB0aGUgRmFyZ2F0ZSBzZXJ2aWNlJyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IHRydWUsXG4gICAgfSk7XG4gICAgc2VydmljZVNlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUobGJTZWN1cml0eUdyb3VwLCBlYzIuUG9ydC50Y3AoODA4MCksICdBbGxvdyB0cmFmZmljIGZyb20gTEInKTtcblxuICAgIC8vIENyZWF0ZSBhIE5ldHdvcmsgTG9hZCBCYWxhbmNlciAocmVxdWlyZWQgZm9yIFZQQyBMaW5rKVxuICAgIGNvbnN0IGxiID0gbmV3IGVsYnYyLk5ldHdvcmtMb2FkQmFsYW5jZXIodGhpcywgJ0NvZGVwaXBlbGluZURlbW9Mb2FkQmFsYW5jZXInLCB7XG4gICAgICB2cGMsXG4gICAgICBpbnRlcm5ldEZhY2luZzogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBhIGxpc3RlbmVyIHRvIHRoZSBsb2FkIGJhbGFuY2VyXG4gICAgY29uc3QgbGlzdGVuZXIgPSBsYi5hZGRMaXN0ZW5lcignTGlzdGVuZXInLCB7XG4gICAgICBwb3J0OiA4MCxcbiAgICB9KTtcblxuICAgIC8vIEZhcmdhdGUgU2VydmljZVxuICAgIGNvbnN0IGZhcmdhdGVTZXJ2aWNlID0gbmV3IGVjcy5GYXJnYXRlU2VydmljZSh0aGlzLCAnQ29kZXBpcGVsaW5lRGVtb1NlcnZpY2UnLCB7XG4gICAgICBjbHVzdGVyLFxuICAgICAgdGFza0RlZmluaXRpb24sXG4gICAgICBkZXNpcmVkQ291bnQ6IDEsXG4gICAgICBhc3NpZ25QdWJsaWNJcDogZmFsc2UsIC8vIFVzaW5nIHByaXZhdGUgc3VibmV0cyB3aXRoIE5BVCBnYXRld2F5XG4gICAgICBzZXJ2aWNlTmFtZTogJ2NvZGVwaXBlbGluZS1kZW1vLXNlcnZpY2UnLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtzZXJ2aWNlU2VjdXJpdHlHcm91cF0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgdGhlIEZhcmdhdGUgc2VydmljZSBhcyBhIHRhcmdldCB0byB0aGUgbG9hZCBiYWxhbmNlclxuICAgIGxpc3RlbmVyLmFkZFRhcmdldHMoJ0ZhcmdhdGVUYXJnZXQnLCB7XG4gICAgICBwb3J0OiA4MDgwLFxuICAgICAgdGFyZ2V0czogW2ZhcmdhdGVTZXJ2aWNlXSxcbiAgICAgIGhlYWx0aENoZWNrOiB7XG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIGhlYWx0aHlUaHJlc2hvbGRDb3VudDogMixcbiAgICAgICAgdW5oZWFsdGh5VGhyZXNob2xkQ291bnQ6IDIsXG4gICAgICAgIGludGVydmFsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygxMCksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQVBJIEdhdGV3YXlcbiAgICBjb25zdCBhcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsICdDb2RlcGlwZWxpbmVEZW1vR2F0ZXdheScsIHtcbiAgICAgIHJlc3RBcGlOYW1lOiAnY29kZXBpcGVsaW5lLWRlbW8tZ2F0ZXdheScsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBHYXRld2F5IGZvciBDb2RlUGlwZWxpbmUgRGVtbycsXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIHN0YWdlTmFtZTogJ3Byb2QnLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBhIFZQQyBMaW5rIGZvciBBUEkgR2F0ZXdheSB0byBhY2Nlc3MgdGhlIE5ldHdvcmsgTG9hZCBCYWxhbmNlclxuICAgIGNvbnN0IHZwY0xpbmsgPSBuZXcgYXBpZ2F0ZXdheS5WcGNMaW5rKHRoaXMsICdDb2RlcGlwZWxpbmVEZW1vVnBjTGluaycsIHtcbiAgICAgIHRhcmdldHM6IFtsYl0sXG4gICAgfSk7XG5cbiAgICAvLyBJbnRlZ3JhdGlvbiBiZXR3ZWVuIEFQSSBHYXRld2F5IGFuZCBOTEJcbiAgICBjb25zdCBpbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkludGVncmF0aW9uKHtcbiAgICAgIHR5cGU6IGFwaWdhdGV3YXkuSW50ZWdyYXRpb25UeXBlLkhUVFBfUFJPWFksXG4gICAgICBpbnRlZ3JhdGlvbkh0dHBNZXRob2Q6ICdBTlknLFxuICAgICAgdXJpOiBgaHR0cDovLyR7bGIubG9hZEJhbGFuY2VyRG5zTmFtZX0vYCxcbiAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgY29ubmVjdGlvblR5cGU6IGFwaWdhdGV3YXkuQ29ubmVjdGlvblR5cGUuVlBDX0xJTkssXG4gICAgICAgIHZwY0xpbmssXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIHJvb3QgcmVzb3VyY2Ugd2l0aCBBTlkgbWV0aG9kXG4gICAgYXBpLnJvb3QuYWRkTWV0aG9kKCdBTlknLCBpbnRlZ3JhdGlvbik7XG5cbiAgICAvLyBDb2RlQnVpbGQgUHJvamVjdFxuICAgIGNvbnN0IGJ1aWxkUHJvamVjdCA9IG5ldyBjb2RlYnVpbGQuUGlwZWxpbmVQcm9qZWN0KHRoaXMsICdDb2RlcGlwZWxpbmVEZW1vQnVpbGRQcm9qZWN0Jywge1xuICAgICAgcHJvamVjdE5hbWU6ICdjb2RlcGlwZWxpbmUtZGVtby1idWlsZCcsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBidWlsZEltYWdlOiBjb2RlYnVpbGQuTGludXhCdWlsZEltYWdlLkFNQVpPTl9MSU5VWF8yXzMsXG4gICAgICAgIHByaXZpbGVnZWQ6IHRydWUsIC8vIFJlcXVpcmVkIGZvciBEb2NrZXIgYnVpbGRzXG4gICAgICB9LFxuICAgICAgZW52aXJvbm1lbnRWYXJpYWJsZXM6IHtcbiAgICAgICAgUkVQT1NJVE9SWV9VUkk6IHtcbiAgICAgICAgICB2YWx1ZTogZWNyUmVwby5yZXBvc2l0b3J5VXJpLFxuICAgICAgICB9LFxuICAgICAgICBDT05UQUlORVJfTkFNRToge1xuICAgICAgICAgIHZhbHVlOiBjb250YWluZXJOYW1lLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGJ1aWxkU3BlYzogY29kZWJ1aWxkLkJ1aWxkU3BlYy5mcm9tT2JqZWN0KHtcbiAgICAgICAgdmVyc2lvbjogJzAuMicsXG4gICAgICAgIHBoYXNlczoge1xuICAgICAgICAgIHByZV9idWlsZDoge1xuICAgICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICAgJ2VjaG8gTG9nZ2luZyBpbiB0byBBbWF6b24gRUNSLi4uJyxcbiAgICAgICAgICAgICAgJ2F3cyBlY3IgZ2V0LWxvZ2luLXBhc3N3b3JkIC0tcmVnaW9uICRBV1NfREVGQVVMVF9SRUdJT04gfCBkb2NrZXIgbG9naW4gLS11c2VybmFtZSBBV1MgLS1wYXNzd29yZC1zdGRpbiAkUkVQT1NJVE9SWV9VUkknLFxuICAgICAgICAgICAgICAnQ09NTUlUX0hBU0g9JChlY2hvICRDT0RFQlVJTERfUkVTT0xWRURfU09VUkNFX1ZFUlNJT04gfCBjdXQgLWMgMS03KScsXG4gICAgICAgICAgICAgICdJTUFHRV9UQUc9JHtDT01NSVRfSEFTSDo9bGF0ZXN0fScsXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgYnVpbGQ6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAgICdlY2hvIEJ1aWxkaW5nIHRoZSBEb2NrZXIgaW1hZ2UuLi4nLFxuICAgICAgICAgICAgICAnY2QgYXBwJyxcbiAgICAgICAgICAgICAgJ2RvY2tlciBidWlsZCAtdCAkUkVQT1NJVE9SWV9VUkk6bGF0ZXN0IC4nLFxuICAgICAgICAgICAgICAnZG9ja2VyIHRhZyAkUkVQT1NJVE9SWV9VUkk6bGF0ZXN0ICRSRVBPU0lUT1JZX1VSSTokSU1BR0VfVEFHJyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwb3N0X2J1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnZWNobyBQdXNoaW5nIHRoZSBEb2NrZXIgaW1hZ2UuLi4nLFxuICAgICAgICAgICAgICAnZG9ja2VyIHB1c2ggJFJFUE9TSVRPUllfVVJJOmxhdGVzdCcsXG4gICAgICAgICAgICAgICdkb2NrZXIgcHVzaCAkUkVQT1NJVE9SWV9VUkk6JElNQUdFX1RBRycsXG4gICAgICAgICAgICAgICdlY2hvIFdyaXRpbmcgaW1hZ2UgZGVmaW5pdGlvbnMgZmlsZS4uLicsXG4gICAgICAgICAgICAgICdhd3MgZWNzIHVwZGF0ZS1zZXJ2aWNlIC0tY2x1c3RlciBjb2RlcGlwZWxpbmUtZGVtby1jbHVzdGVyIC0tc2VydmljZSBjb2RlcGlwZWxpbmUtZGVtby1zZXJ2aWNlIC0tZm9yY2UtbmV3LWRlcGxveW1lbnQnLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyB0byBDb2RlQnVpbGRcbiAgICBlY3JSZXBvLmdyYW50UHVsbFB1c2goYnVpbGRQcm9qZWN0LnJvbGUhKTtcbiAgICBidWlsZFByb2plY3QuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnZWNzOlVwZGF0ZVNlcnZpY2UnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgLy8gQ29kZVBpcGVsaW5lXG4gICAgY29uc3Qgc291cmNlT3V0cHV0ID0gbmV3IGNvZGVwaXBlbGluZS5BcnRpZmFjdCgpO1xuICAgIGNvbnN0IGJ1aWxkT3V0cHV0ID0gbmV3IGNvZGVwaXBlbGluZS5BcnRpZmFjdCgpO1xuXG4gICAgY29uc3QgcGlwZWxpbmUgPSBuZXcgY29kZXBpcGVsaW5lLlBpcGVsaW5lKHRoaXMsICdDb2RlcGlwZWxpbmVEZW1vUGlwZWxpbmUnLCB7XG4gICAgICBwaXBlbGluZU5hbWU6ICdjb2RlcGlwZWxpbmUtZGVtby1waXBlbGluZScsXG4gICAgICByZXN0YXJ0RXhlY3V0aW9uT25VcGRhdGU6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyBTb3VyY2UgU3RhZ2VcbiAgICBwaXBlbGluZS5hZGRTdGFnZSh7XG4gICAgICBzdGFnZU5hbWU6ICdTb3VyY2UnLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICBuZXcgY29kZXBpcGVsaW5lX2FjdGlvbnMuQ29kZVN0YXJDb25uZWN0aW9uc1NvdXJjZUFjdGlvbih7XG4gICAgICAgICAgYWN0aW9uTmFtZTogJ0dpdEh1Yl9Tb3VyY2UnLFxuICAgICAgICAgIG93bmVyOiAnYnJlbnRnZm94YXdzJyxcbiAgICAgICAgICByZXBvOiAnY29kZXBpcGVsaW5lLWRlbW8nLFxuICAgICAgICAgIGJyYW5jaDogJ21haW4nLFxuICAgICAgICAgIGNvbm5lY3Rpb25Bcm46ICdhcm46YXdzOmNvZGVjb25uZWN0aW9uczpjYS1jZW50cmFsLTE6NTgyODI4MzE4MDA4OmNvbm5lY3Rpb24vYWRiYjhmNjMtY2ZlMS00M2RlLWI3YzItMDVlY2YyM2UyMWI3JyxcbiAgICAgICAgICBvdXRwdXQ6IHNvdXJjZU91dHB1dCxcbiAgICAgICAgfSksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gQnVpbGQgU3RhZ2VcbiAgICBwaXBlbGluZS5hZGRTdGFnZSh7XG4gICAgICBzdGFnZU5hbWU6ICdCdWlsZCcsXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgIG5ldyBjb2RlcGlwZWxpbmVfYWN0aW9ucy5Db2RlQnVpbGRBY3Rpb24oe1xuICAgICAgICAgIGFjdGlvbk5hbWU6ICdCdWlsZEFuZFB1c2gnLFxuICAgICAgICAgIHByb2plY3Q6IGJ1aWxkUHJvamVjdCxcbiAgICAgICAgICBpbnB1dDogc291cmNlT3V0cHV0LFxuICAgICAgICAgIG91dHB1dHM6IFtidWlsZE91dHB1dF0sXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIE91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpR2F0ZXdheVVybCcsIHtcbiAgICAgIHZhbHVlOiBhcGkudXJsLFxuICAgICAgZGVzY3JpcHRpb246ICdVUkwgb2YgdGhlIEFQSSBHYXRld2F5JyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdMb2FkQmFsYW5jZXJEbnMnLCB7XG4gICAgICB2YWx1ZTogbGIubG9hZEJhbGFuY2VyRG5zTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRE5TIE5hbWUgb2YgdGhlIExvYWQgQmFsYW5jZXInLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0VjclJlcG9zaXRvcnlVcmknLCB7XG4gICAgICB2YWx1ZTogZWNyUmVwby5yZXBvc2l0b3J5VXJpLFxuICAgICAgZGVzY3JpcHRpb246ICdVUkkgb2YgdGhlIEVDUiBSZXBvc2l0b3J5JyxcbiAgICB9KTtcbiAgfVxufSJdfQ==