import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import { githubConfig, regionConfig } from './config';

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
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
              'aws ecr describe-repositories --repository-names codepipeline-demo --region ' + regionConfig.appRegion + ' || aws ecr create-repository --repository-name codepipeline-demo --region ' + regionConfig.appRegion,
              'echo Pushing the Docker image to app region...',
              'APP_REPO=$(echo $REPOSITORY_URI | sed "s/' + regionConfig.pipelineRegion + '/' + regionConfig.appRegion + '/g")',
              'aws ecr get-login-password --region ' + regionConfig.appRegion + ' | docker login --username AWS --password-stdin $APP_REPO',
              'docker tag $REPOSITORY_URI:latest $APP_REPO:latest',
              'docker tag $REPOSITORY_URI:$IMAGE_TAG $APP_REPO:$IMAGE_TAG',
              'docker push $APP_REPO:latest',
              'docker push $APP_REPO:$IMAGE_TAG',
              'echo Updating ECS service in app region...',
              'aws ecs update-service --cluster codepipeline-demo-cluster --service codepipeline-demo-service --force-new-deployment --region ' + regionConfig.appRegion,
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
      resources: ['arn:aws:ecr:' + regionConfig.appRegion + ':' + regionConfig.accountId + ':repository/codepipeline-demo'],
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
          owner: githubConfig.owner,
          repo: githubConfig.repo,
          branch: githubConfig.branch,
          connectionArn: githubConfig.connectionArn,
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