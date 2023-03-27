# About

This application is a combination of an Angular application and an AWS CDK application. The purpose is to show how one could create, build, deploy, and maintain an angular application in AWS via the AWS CDK with CI/CD pipeline configuration. The angular application resides in the root of the repository while the CDK app resides in the CDK folder. There are modifications both apps to make this work and I'll attempt to cover all modifications and reasoning as best I can.

For the Angular application, you will need to create an additional build configuration. In my case, I called it `dev` but you could have many ex: dev, test, qa, production. These can all be supported through this example repository. You will find the build configurations in the angular.json in the root of the repository. There are currently 3 albeit `development` is your local development work. We'll mainly focus on `production` and `dev`. Each environment has its' own environment.ts file under the `src/environments/` folder. This allows you to have differing environment variables specific to the environment you're building. 

For the CDK, we have created our environment/app information in the cdk.json, however; this information could be overridden with the context flag and the appropriate key value pairs passed. I won't get into that too much though. If we look at the cdk.json within the `cdk/` folder, we can note that we have a globals section which defines our base application and variables. These are variables that are not specific to any one environment. Beyond that, we have variables for both `dev` and `production`. These variables are required to deploy the project and most should be self-explanatory. There is one assumption in here. In my example, I'm using a CodeStar connection that I previously setup. You will want to setup a similar CodeStar connection within your aws account pointing to github and then paste the arn in the value there. Hopefully, you've forked this repo so you can set the owner and repo name to whatever you may be using. The owner is often the user but can also be an organization. Finally, I'm using 2 branches `dev` and `main`. You can create as many environments as you need and as many branches as fit those environments. With all that in mind, to deploy the stack and app into an environment you can issue the commands:

`cdk bootstrap --context ENV_NAME=dev`
`cdk synth --context ENV_NAME=dev`
`cdk deploy --context ENV_NAME=dev`

You would replace dev in the above commands with whatever region you've configured.

## AwsCdkPipelineAngular

This project was generated with [Angular CLI](https://github.com/angular/angular-cli) version 14.2.8.

## Development server

Run `ng serve` for a dev server. Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

## Code scaffolding

Run `ng generate component component-name` to generate a new component. You can also use `ng generate directive|pipe|service|class|guard|interface|enum|module`.

## Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

## Running unit tests

Run `ng test` to execute the unit tests via [Karma](https://karma-runner.github.io).

## Running end-to-end tests

Run `ng e2e` to execute the end-to-end tests via a platform of your choice. To use this command, you need to first add a package that implements end-to-end testing capabilities.

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI Overview and Command Reference](https://angular.io/cli) page.
