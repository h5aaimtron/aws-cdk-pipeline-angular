import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { aws_cloudfront as cloudfront } from 'aws-cdk-lib';
import { Artifact, Pipeline, StageOptions } from 'aws-cdk-lib/aws-codepipeline';
import { BuildSpec, LinuxBuildImage, PipelineProject } from 'aws-cdk-lib/aws-codebuild';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { DnsValidatedCertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { CloudFrontWebDistribution, OriginAccessIdentity, ViewerCertificate } from 'aws-cdk-lib/aws-cloudfront';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { CodeBuildStep, CodePipeline, CodePipelineFileSet } from 'aws-cdk-lib/pipelines';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // Look up environment specific configuration. Default to dev.
    const envName: string = this.node.tryGetContext('ENV_NAME') || 'development';
    console.log(`Environment: ${envName}`);

    // Create a CDKContext object that follows our structure. The values for this can be found in the cdk.json file.
    const envConfig = scope.node.tryGetContext(envName);
    const globalConfig = scope.node.tryGetContext('globals');
    const context: CDKContext = { ...globalConfig, ...envConfig };
    console.log(context);

    // Define s3 bucket. Removed PublicReadAccess: true as this will cause
    // an error given S3 new default block all.
    const appBucket = new s3.Bucket(this, `${context.appName}-bucket`, {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // This flags S3 bucket to be destroyed when you want to tear down your infrastructure.
      autoDeleteObjects: true
    });

    // Configure domain and sub-domain urls.
    const domainName = context.domain;
    const subDomainName = `${context.appName}.` + domainName; // We're deploying off a subdomain, but you could remove this property and set all references to it to domainName if you're doing top level.
    console.log(`domainName: ${domainName}`);
    console.log(`subDomainName: ${subDomainName}`);

    // Look up hosted zone.
    const hostedZone = HostedZone.fromLookup(this, domainName, {
      domainName: domainName,
      privateZone: false,
    });

    // Define SSL Certificate (only use us-east-1). TODO: Replace with Certificate
    const frontendCertificate = new DnsValidatedCertificate(this, `${context.appName}-certificate`, {
      domainName: subDomainName,
      hostedZone: hostedZone,
      region: 'us-east-1',
    });

    const viewerCertificate = ViewerCertificate.fromAcmCertificate(frontendCertificate, { // .fromIamCertificate('MYIAMROLEIDENTIFIER', {
      aliases: [subDomainName],
    });

    // Define CloudFront Distribution with error responses.
    const accessDeniedErrorResponse: cloudfront.CfnDistribution.CustomErrorResponseProperty = {
      errorCode: 403,
      errorCachingMinTtl: 30,
      responseCode: 200,
      responsePagePath: '/index.html',
    };
    const notFoundErrorResponse: cloudfront.CfnDistribution.CustomErrorResponseProperty = {
      errorCode: 404,
      errorCachingMinTtl: 30,
      responseCode: 200,
      responsePagePath: '/index.html',
    };

    // Create Origin Access Identity and have s3 grant read access
    const oai = new OriginAccessIdentity(this, `${context.appName}-${context.environment}-origin-access-id`, {});
    appBucket.grantRead(oai);

    const distribution = new CloudFrontWebDistribution(this, `${context.appName}-web-distribution`, {
      originConfigs: [
        {
          s3OriginSource: {
            s3BucketSource: appBucket,
            originAccessIdentity: oai
          },
          behaviors: [{ isDefaultBehavior: true }],
        },
      ],
      viewerCertificate: viewerCertificate,
      errorConfigurations: [
        accessDeniedErrorResponse,
        notFoundErrorResponse
      ]
    });

    // Define A Record in Route53 for sub-domain.
    new ARecord(this, 'ARecord', {
      recordName: subDomainName,
      zone: hostedZone,
      target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
    });

    // Output the url of the website.
    new cdk.CfnOutput(this, 'URL', {
      description: 'The url of the website',
      value: appBucket.bucketWebsiteUrl + "\n" + subDomainName
    });

    // AWS CodeBuild artifacts
    const outputSources = new Artifact(`${context.appName}-ui-source-artifact`);
    const outputArtifact = new Artifact(`${context.appName}-ui-app-deploy-artifact`);

    // Define our pipeline and stages.
    const pipeline = new Pipeline(this, `${context.appName}UIPipeline`, {
      restartExecutionOnUpdate: true
    });

    // Create Source Stage.
    let sourceStage: StageOptions = {
      stageName: 'Source',
      actions: [
        new cdk.aws_codepipeline_actions.CodeStarConnectionsSourceAction({
          actionName: 'Checkout',
          branch: context.repo.branch,
          connectionArn: context.codeStarConnectionArn,
          output: outputSources,
          owner: context.repo.owner,
          repo: context.repo.name
        })
      ]
    };
    pipeline.addStage(sourceStage);

    // Create Build Stage.
    let buildStage: StageOptions = {
      stageName: 'BuildApp', // Cannot be `Build` as that name is reserved during the synth step.
      actions: [
        new cdk.aws_codepipeline_actions.CodeBuildAction({
          actionName: `${context.appName}-build-action`,
          project: new PipelineProject(this, `${context.appName}-build-project-id`, {
            projectName: `${context.appName}-build-project`,
            environment: {
              buildImage: LinuxBuildImage.AMAZON_LINUX_2_4
            },
            buildSpec: BuildSpec.fromObject({
              version: 0.2,
              phases: {
                install: {
                  'runtime-versions': {
                    nodejs: 16
                  },
                  commands: [
                    'npm install -g @angular/cli@14.2.8', // I'm using 14.2.8, but this can be changed to match your needs.
                    'npm install'
                  ]
                },
                build: {
                  commands: [
                    'echo Build started',
                    'ng build --configuration=' + context.environment // This allows you to pass the environment through so your builds align with your pipelines/envs.
                  ]
                },
                post_build: {
                  commands: [
                    'echo Build Complete'
                  ]
                }
              },
              artifacts: {
                'files': ['**/*'],
                'base-directory': context.baseDir
              }
            })
          }),
          input: outputSources,
          outputs: [outputArtifact]
        })
      ]
    };
    pipeline.addStage(buildStage);

    // Create Approval Stage for Production only.
    if (context.isProd) {
      let approveStage: StageOptions = {
        stageName: 'Approve',
        actions: [
          new cdk.aws_codepipeline_actions.ManualApprovalAction({
            actionName: "ApprovalAction"
          })
        ]
      }
      pipeline.addStage(approveStage);
    }

    // Create CloudFront Distribution Invalidation Project.
    const invalidateBuildProject = new PipelineProject(this, `${context.appName}-invalidate-project-id`, {
      environmentVariables: {
        CLOUDFRONT_ID: { value: distribution.distributionId }
      },
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        phases: {
          build: {
            commands: [
              'aws cloudfront create-invalidation --distribution-id ${CLOUDFRONT_ID} --paths "/*"'
            ]
          }
        }
      })
    });

    // Add CloudFront invalidation permissions to the project. If you don't create invalidations, your site may be cached for a lengthy period of time.
    const distributionArn = `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`
    invalidateBuildProject.addToRolePolicy(new PolicyStatement({
      resources: [distributionArn],
      actions: [
        'cloudfront:CreateInvalidation',
      ],
    }));

    // Create Deployment Stage.
    let deployStage: StageOptions = {
      stageName: "DeployApp",
      actions: [
        new cdk.aws_codepipeline_actions.S3DeployAction({
          actionName: "DeployApplication",
          input: outputArtifact,
          bucket: appBucket,
          runOrder: 1
        }),
        new cdk.aws_codepipeline_actions.CodeBuildAction({
          actionName: "InvalidateCache",
          project: invalidateBuildProject,
          input: outputArtifact,
          runOrder: 2
        })
      ]
    };
    pipeline.addStage(deployStage);

    // Creates synth step that allows for your pipeline to self mutate when infrastructure changes occur.
    const synthPipeline = new CodePipeline(this, `${context.appName}-synth-pipeline-id`, {
      codePipeline: pipeline,
      synth: new CodeBuildStep('Synth', {
        input: CodePipelineFileSet.fromArtifact(outputSources),
        installCommands: ["npm install -g aws-cdk"],
        commands: [
          'cd cdk',
          'npm ci',
          'npm run build',
          'npx cdk synth --context ENV_NAME=' + context.environment
        ],
        primaryOutputDirectory: "cdk/cdk.out"
      })
    });
  }
}

export type CDKContext = {
  appName: string;
  region: string;
  environment: string;
  isProd: boolean;
  domain: string;
  baseDir: string;
  codeStarConnectionArn: string;
  repo: {
    owner: string,
    name: string,
    branch: string
  }
}