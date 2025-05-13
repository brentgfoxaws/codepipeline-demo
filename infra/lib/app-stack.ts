import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { regionConfig } from './config';

export class AppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Add a Name tag to all resources in this stack
    cdk.Tags.of(this).add('Name', 'codepipeline-demo');

    // Reference the ECR repository in the app region
    const ecrRepoArn = `arn:aws:ecr:${regionConfig.appRegion}:${regionConfig.accountId}:repository/codepipeline-demo`;
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