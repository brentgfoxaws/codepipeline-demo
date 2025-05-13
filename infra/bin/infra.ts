#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PipelineStack } from '../lib/pipeline-stack';
import { AppStack } from '../lib/app-stack';
import { regionConfig } from '../lib/config';

const app = new cdk.App();

// Pipeline Stack in ca-central-1
new PipelineStack(app, 'CodepipelineDemoPipelineStack', {
  env: { 
    account: regionConfig.accountId, 
    region: regionConfig.pipelineRegion 
  },
  description: 'CodePipeline Demo Pipeline Stack in ca-central-1',
});

// Application Stack in ca-west-1
new AppStack(app, 'CodepipelineDemoAppStack', {
  env: { 
    account: regionConfig.accountId, 
    region: regionConfig.appRegion 
  },
  description: 'CodePipeline Demo Application Stack with ECS Fargate in ca-west-1',
});