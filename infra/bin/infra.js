#!/usr/bin/env node
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
require("source-map-support/register");
const cdk = __importStar(require("aws-cdk-lib"));
const pipeline_stack_1 = require("../lib/pipeline-stack");
const app_stack_1 = require("../lib/app-stack");
const config_1 = require("../lib/config");
const app = new cdk.App();
// Pipeline Stack in ca-central-1
new pipeline_stack_1.PipelineStack(app, 'CodepipelineDemoPipelineStack', {
    env: {
        account: config_1.regionConfig.accountId,
        region: config_1.regionConfig.pipelineRegion
    },
    description: 'CodePipeline Demo Pipeline Stack in ca-central-1',
});
// Application Stack in ca-west-1
new app_stack_1.AppStack(app, 'CodepipelineDemoAppStack', {
    env: {
        account: config_1.regionConfig.accountId,
        region: config_1.regionConfig.appRegion
    },
    description: 'CodePipeline Demo Application Stack with ECS Fargate in ca-west-1',
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mcmEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmZyYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUNBLHVDQUFxQztBQUNyQyxpREFBbUM7QUFDbkMsMERBQXNEO0FBQ3RELGdEQUE0QztBQUM1QywwQ0FBNkM7QUFFN0MsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7QUFFMUIsaUNBQWlDO0FBQ2pDLElBQUksOEJBQWEsQ0FBQyxHQUFHLEVBQUUsK0JBQStCLEVBQUU7SUFDdEQsR0FBRyxFQUFFO1FBQ0gsT0FBTyxFQUFFLHFCQUFZLENBQUMsU0FBUztRQUMvQixNQUFNLEVBQUUscUJBQVksQ0FBQyxjQUFjO0tBQ3BDO0lBQ0QsV0FBVyxFQUFFLGtEQUFrRDtDQUNoRSxDQUFDLENBQUM7QUFFSCxpQ0FBaUM7QUFDakMsSUFBSSxvQkFBUSxDQUFDLEdBQUcsRUFBRSwwQkFBMEIsRUFBRTtJQUM1QyxHQUFHLEVBQUU7UUFDSCxPQUFPLEVBQUUscUJBQVksQ0FBQyxTQUFTO1FBQy9CLE1BQU0sRUFBRSxxQkFBWSxDQUFDLFNBQVM7S0FDL0I7SUFDRCxXQUFXLEVBQUUsbUVBQW1FO0NBQ2pGLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcbmltcG9ydCAnc291cmNlLW1hcC1zdXBwb3J0L3JlZ2lzdGVyJztcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBQaXBlbGluZVN0YWNrIH0gZnJvbSAnLi4vbGliL3BpcGVsaW5lLXN0YWNrJztcbmltcG9ydCB7IEFwcFN0YWNrIH0gZnJvbSAnLi4vbGliL2FwcC1zdGFjayc7XG5pbXBvcnQgeyByZWdpb25Db25maWcgfSBmcm9tICcuLi9saWIvY29uZmlnJztcblxuY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcblxuLy8gUGlwZWxpbmUgU3RhY2sgaW4gY2EtY2VudHJhbC0xXG5uZXcgUGlwZWxpbmVTdGFjayhhcHAsICdDb2RlcGlwZWxpbmVEZW1vUGlwZWxpbmVTdGFjaycsIHtcbiAgZW52OiB7IFxuICAgIGFjY291bnQ6IHJlZ2lvbkNvbmZpZy5hY2NvdW50SWQsIFxuICAgIHJlZ2lvbjogcmVnaW9uQ29uZmlnLnBpcGVsaW5lUmVnaW9uIFxuICB9LFxuICBkZXNjcmlwdGlvbjogJ0NvZGVQaXBlbGluZSBEZW1vIFBpcGVsaW5lIFN0YWNrIGluIGNhLWNlbnRyYWwtMScsXG59KTtcblxuLy8gQXBwbGljYXRpb24gU3RhY2sgaW4gY2Etd2VzdC0xXG5uZXcgQXBwU3RhY2soYXBwLCAnQ29kZXBpcGVsaW5lRGVtb0FwcFN0YWNrJywge1xuICBlbnY6IHsgXG4gICAgYWNjb3VudDogcmVnaW9uQ29uZmlnLmFjY291bnRJZCwgXG4gICAgcmVnaW9uOiByZWdpb25Db25maWcuYXBwUmVnaW9uIFxuICB9LFxuICBkZXNjcmlwdGlvbjogJ0NvZGVQaXBlbGluZSBEZW1vIEFwcGxpY2F0aW9uIFN0YWNrIHdpdGggRUNTIEZhcmdhdGUgaW4gY2Etd2VzdC0xJyxcbn0pOyJdfQ==