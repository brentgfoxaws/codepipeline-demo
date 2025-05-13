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
exports.AppStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const ecr = __importStar(require("aws-cdk-lib/aws-ecr"));
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const elbv2 = __importStar(require("aws-cdk-lib/aws-elasticloadbalancingv2"));
const config_1 = require("./config");
class AppStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // Add a Name tag to all resources in this stack
        cdk.Tags.of(this).add('Name', 'codepipeline-demo');
        // Reference the ECR repository in the app region
        const ecrRepoArn = `arn:aws:ecr:${config_1.regionConfig.appRegion}:${config_1.regionConfig.accountId}:repository/codepipeline-demo`;
        const ecrRepo = ecr.Repository.fromRepositoryArn(this, 'AppRegionEcrRepo', ecrRepoArn);
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
            // Use the cross-region ECR repository
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
        // Outputs
        new cdk.CfnOutput(this, 'ApplicationUrl', {
            value: `http://${lb.loadBalancerDnsName}`,
            description: 'URL of the Application',
        });
    }
}
exports.AppStack = AppStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBwLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBRW5DLHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MseURBQTJDO0FBQzNDLDJEQUE2QztBQUM3Qyw4RUFBZ0U7QUFDaEUscUNBQXdDO0FBRXhDLE1BQWEsUUFBUyxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3JDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsZ0RBQWdEO1FBQ2hELEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsbUJBQW1CLENBQUMsQ0FBQztRQUVuRCxpREFBaUQ7UUFDakQsTUFBTSxVQUFVLEdBQUcsZUFBZSxxQkFBWSxDQUFDLFNBQVMsSUFBSSxxQkFBWSxDQUFDLFNBQVMsK0JBQStCLENBQUM7UUFDbEgsTUFBTSxPQUFPLEdBQUcsR0FBRyxDQUFDLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUUsVUFBVSxDQUFDLENBQUM7UUFFdkYsa0JBQWtCO1FBQ2xCLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7WUFDbkQsTUFBTSxFQUFFLENBQUM7WUFDVCxXQUFXLEVBQUUsQ0FBQztTQUNmLENBQUMsQ0FBQztRQUVILGNBQWM7UUFDZCxNQUFNLE9BQU8sR0FBRyxJQUFJLEdBQUcsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLHlCQUF5QixFQUFFO1lBQy9ELEdBQUc7WUFDSCxXQUFXLEVBQUUsMkJBQTJCO1NBQ3pDLENBQUMsQ0FBQztRQUVILGtCQUFrQjtRQUNs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QUMsRUFBRSxDQUFDO2dCQUNsQyxPQUFPLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO2FBQ2pDO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsVUFBVTtRQUNWLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDeEMsS0FBSyxFQUFFLFVBQVUsRUFBRSxDQUFDLG1CQUFtQixFQUFFO1lBQ3pDLFdBQVcsRUFBRSx3QkFBd0I7U0FDdEMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBckdELDRCQXFHQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIGVjciBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNyJztcbmltcG9ydCAqIGFzIGVjcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0ICogYXMgZWxidjIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVsYXN0aWNsb2FkYmFsYW5jaW5ndjInO1xuaW1wb3J0IHsgcmVnaW9uQ29uZmlnIH0gZnJvbSAnLi9jb25maWcnO1xuXG5leHBvcnQgY2xhc3MgQXBwU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG4gICAgXG4gICAgLy8gQWRkIGEgTmFtZSB0YWcgdG8gYWxsIHJlc291cmNlcyBpbiB0aGlzIHN0YWNrXG4gICAgY2RrLlRhZ3Mub2YodGhpcykuYWRkKCdOYW1lJywgJ2NvZGVwaXBlbGluZS1kZW1vJyk7XG5cbiAgICAvLyBSZWZlcmVuY2UgdGhlIEVDUiByZXBvc2l0b3J5IGluIHRoZSBhcHAgcmVnaW9uXG4gICAgY29uc3QgZWNyUmVwb0FybiA9IGBhcm46YXdzOmVjcjoke3JlZ2lvbkNvbmZpZy5hcHBSZWdpb259OiR7cmVnaW9uQ29uZmlnLmFjY291bnRJZH06cmVwb3NpdG9yeS9jb2RlcGlwZWxpbmUtZGVtb2A7XG4gICAgY29uc3QgZWNyUmVwbyA9IGVjci5SZXBvc2l0b3J5LmZyb21SZXBvc2l0b3J5QXJuKHRoaXMsICdBcHBSZWdpb25FY3JSZXBvJywgZWNyUmVwb0Fybik7XG5cbiAgICAvLyBWUEMgZm9yIEZhcmdhdGVcbiAgICBjb25zdCB2cGMgPSBuZXcgZWMyLlZwYyh0aGlzLCAnQ29kZXBpcGVsaW5lRGVtb1ZwYycsIHtcbiAgICAgIG1heEF6czogMixcbiAgICAgIG5hdEdhdGV3YXlzOiAxLFxuICAgIH0pO1xuXG4gICAgLy8gRUNTIENsdXN0ZXJcbiAgICBjb25zdCBjbHVzdGVyID0gbmV3IGVjcy5DbHVzdGVyKHRoaXMsICdDb2RlcGlwZWxpbmVEZW1vQ2x1c3RlcicsIHtcbiAgICAgIHZwYyxcbiAgICAgIGNsdXN0ZXJOYW1lOiAnY29kZXBpcGVsaW5lLWRlbW8tY2x1c3RlcicsXG4gICAgfSk7XG5cbiAgICAvLyBUYXNrIERlZmluaXRpb25cbiAgICBjb25zdCB0YXNrRGVmaW5pdGlvbiA9IG5ldyBlY3MuRmFyZ2F0ZVRhc2tEZWZpbml0aW9uKHRoaXMsICdDb2RlcGlwZWxpbmVEZW1vVGFza0RlZicsIHtcbiAgICAgIG1lbW9yeUxpbWl0TWlCOiA1MTIsXG4gICAgICBjcHU6IDI1NixcbiAgICB9KTtcblxuICAgIC8vIEFkZCBjb250YWluZXIgdG8gdGFzayBkZWZpbml0aW9uXG4gICAgY29uc3QgY29udGFpbmVyTmFtZSA9ICdjb2RlcGlwZWxpbmUtZGVtbyc7XG4gICAgY29uc3QgY29udGFpbmVyID0gdGFza0RlZmluaXRpb24uYWRkQ29udGFpbmVyKGNvbnRhaW5lck5hbWUsIHtcbiAgICAgIC8vIFVzZSB0aGUgY3Jvc3MtcmVnaW9uIEVDUiByZXBvc2l0b3J5XG4gICAgICBpbWFnZTogZWNzLkNvbnRhaW5lckltYWdlLmZyb21FY3JSZXBvc2l0b3J5KGVjclJlcG8pLFxuICAgICAgbG9nZ2luZzogZWNzLkxvZ0RyaXZlcnMuYXdzTG9ncyh7XG4gICAgICAgIHN0cmVhbVByZWZpeDogJ2NvZGVwaXBlbGluZS1kZW1vJyxcbiAgICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICB9KSxcbiAgICAgIHBvcnRNYXBwaW5nczogW3sgY29udGFpbmVyUG9ydDogODA4MCB9XSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBhIHNlY3VyaXR5IGdyb3VwIGZvciB0aGUgQXBwbGljYXRpb24gTG9hZCBCYWxhbmNlclxuICAgIGNvbnN0IGFsYlNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ0FsYlNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGMsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlY3VyaXR5IGdyb3VwIGZvciB0aGUgQXBwbGljYXRpb24gTG9hZCBCYWxhbmNlcicsXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiB0cnVlLFxuICAgIH0pO1xuICAgIGFsYlNlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoZWMyLlBlZXIuYW55SXB2NCgpLCBlYzIuUG9ydC50Y3AoODApLCAnQWxsb3cgSFRUUCB0cmFmZmljIGZyb20gaW50ZXJuZXQnKTtcblxuICAgIC8vIENyZWF0ZSBhIHNlY3VyaXR5IGdyb3VwIGZvciB0aGUgRmFyZ2F0ZSBzZXJ2aWNlXG4gICAgY29uc3Qgc2VydmljZVNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ1NlcnZpY2VTZWN1cml0eUdyb3VwJywge1xuICAgICAgdnBjLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgdGhlIEZhcmdhdGUgc2VydmljZScsXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiB0cnVlLFxuICAgIH0pO1xuICAgIHNlcnZpY2VTZWN1cml0eUdyb3VwLmFkZEluZ3Jlc3NSdWxlKGFsYlNlY3VyaXR5R3JvdXAsIGVjMi5Qb3J0LnRjcCg4MDgwKSwgJ0FsbG93IHRyYWZmaWMgZnJvbSBBTEIgb24gcG9ydCA4MDgwIG9ubHknKTtcblxuICAgIC8vIENyZWF0ZSBhbiBBcHBsaWNhdGlvbiBMb2FkIEJhbGFuY2VyXG4gICAgY29uc3QgbGIgPSBuZXcgZWxidjIuQXBwbGljYXRpb25Mb2FkQmFsYW5jZXIodGhpcywgJ0NvZGVwaXBlbGluZURlbW9Mb2FkQmFsYW5jZXInLCB7XG4gICAgICB2cGMsXG4gICAgICBpbnRlcm5ldEZhY2luZzogdHJ1ZSxcbiAgICAgIHNlY3VyaXR5R3JvdXA6IGFsYlNlY3VyaXR5R3JvdXAsXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgYSBsaXN0ZW5lciB0byB0aGUgbG9hZCBiYWxhbmNlclxuICAgIGNvbnN0IGxpc3RlbmVyID0gbGIuYWRkTGlzdGVuZXIoJ0xpc3RlbmVyJywge1xuICAgICAgcG9ydDogODAsXG4gICAgICBvcGVuOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gRmFyZ2F0ZSBTZXJ2aWNlXG4gICAgY29uc3QgZmFyZ2F0ZVNlcnZpY2UgPSBuZXcgZWNzLkZhcmdhdGVTZXJ2aWNlKHRoaXMsICdDb2RlcGlwZWxpbmVEZW1vU2VydmljZScsIHtcbiAgICAgIGNsdXN0ZXIsXG4gICAgICB0YXNrRGVmaW5pdGlvbixcbiAgICAgIGRlc2lyZWRDb3VudDogMSxcbiAgICAgIGFzc2lnblB1YmxpY0lwOiBmYWxzZSwgLy8gVXNpbmcgcHJpdmF0ZSBzdWJuZXRzIHdpdGggTkFUIGdhdGV3YXlcbiAgICAgIHNlcnZpY2VOYW1lOiAnY29kZXBpcGVsaW5lLWRlbW8tc2VydmljZScsXG4gICAgICBzZWN1cml0eUdyb3VwczogW3NlcnZpY2VTZWN1cml0eUdyb3VwXSxcbiAgICB9KTtcblxuICAgIC8vIEFkZCB0aGUgRmFyZ2F0ZSBzZXJ2aWNlIGFzIGEgdGFyZ2V0IHRvIHRoZSBsb2FkIGJhbGFuY2VyXG4gICAgbGlzdGVuZXIuYWRkVGFyZ2V0cygnRmFyZ2F0ZVRhcmdldCcsIHtcbiAgICAgIHBvcnQ6IDgwODAsXG4gICAgICB0YXJnZXRzOiBbZmFyZ2F0ZVNlcnZpY2VdLFxuICAgICAgaGVhbHRoQ2hlY2s6IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgcGF0aDogJy9oZWFsdGgnLFxuICAgICAgICBwcm90b2NvbDogZWxidjIuUHJvdG9jb2wuSFRUUCxcbiAgICAgICAgaGVhbHRoeVRocmVzaG9sZENvdW50OiAyLFxuICAgICAgICB1bmhlYWx0aHlUaHJlc2hvbGRDb3VudDogMixcbiAgICAgICAgaW50ZXJ2YWw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcHBsaWNhdGlvblVybCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cDovLyR7bGIubG9hZEJhbGFuY2VyRG5zTmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdVUkwgb2YgdGhlIEFwcGxpY2F0aW9uJyxcbiAgICB9KTtcbiAgfVxufSJdfQ==