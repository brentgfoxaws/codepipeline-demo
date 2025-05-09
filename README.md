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

## Deployment Instructions

### Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js and npm installed
- AWS CDK installed (`npm install -g aws-cdk`)

### Steps to Deploy

1. Update the GitHub connection details in `infra/lib/infra-stack.ts`:
   - Replace `REPLACE_WITH_GITHUB_OWNER` with your GitHub username or organization
   - Replace `REPLACE_WITH_GITHUB_REPO` with your repository name
   - Replace `REPLACE_WITH_CONNECTION_ARN` with your AWS CodeStar connection ARN

2. Deploy the CDK stack:
   ```bash
   cd infra
   npm run build
   cdk deploy
   ```

3. Once deployed, you can access the application via the API Gateway URL provided in the stack outputs.

## Local Development

To run the application locally:

```bash
cd app
pip install -r requirements.txt
python src/app.py
```

The application will be available at http://localhost:8080