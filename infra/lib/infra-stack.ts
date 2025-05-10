import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
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

    // Create an Application Load Balancer with security group
    const lb = new elbv2.ApplicationLoadBalancer(this, 'CodepipelineDemoLoadBalancer', {
      vpc,
      internetFacing: true,
      securityGroup: lbSecurityGroup,
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
        path: '/health',
        protocol: elbv2.Protocol.HTTP,
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
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

    // Create a VPC Link for API Gateway to access the Application Load Balancer
    const vpcLink = new apigateway.VpcLink(this, 'CodepipelineDemoVpcLink', {
      targets: [lb],
    });

    // Integration between API Gateway and ALB
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
    ecrRepo.grantPullPush(buildProject.role!);
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