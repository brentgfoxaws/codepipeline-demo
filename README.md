# CodePipeline Demo

This project demonstrates a complete CI/CD pipeline using AWS CDK, CodePipeline, and CodeBuild to deploy a containerized Python application to AWS Fargate with API Gateway integration.

## Project Structure

- `/app` - Contains the Python Flask application and Dockerfile
- `/infra` - Contains the AWS CDK infrastructure code

## Application

The application is a simple Flask web server that returns "Hello AMA" when accessed.

## Infrastructure

The infrastructure includes:

- ECR Repository named `ama-demo` for storing the container image
- ECS Fargate service to run the container
- API Gateway named `ama-gateway1` to provide HTTP access to the application
- CodeBuild project to build and push the Docker image
- CodePipeline to automate the deployment process

