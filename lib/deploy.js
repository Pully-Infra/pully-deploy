const cdk = require("aws-cdk-lib");
const { v4: uuid } = require("uuid");
const s3 = require("aws-cdk-lib/aws-s3");
const ecs = require("aws-cdk-lib/aws-ecs");
const ec2 = require("aws-cdk-lib/aws-ec2");
const iam = require("aws-cdk-lib/aws-iam");
const logs = require("aws-cdk-lib/aws-logs");
const ElastiCache = require("./elastiCache");
const ecsPatterns = require("aws-cdk-lib/aws-ecs-patterns");
const { randomWords } = require("../utils/helpers");

const port = 3008;
const vpcName = "PullyVpc";
const cacheName = "PullyRedis";
const log = "PullyServerTaskLog";
const bucketName = "PullyBucket";
const serviceName = "PullyService";
const clusterName = "PullyCluster";
const containerName = "PullyContainer";
const lambdaRoleName = "pully-lambda-role";
const bucketNameString = "pully-general-bucket";
const taskDefinitionName = "PullyTaskDefinition";
const lambdaExecutionRoleName = "PullyLambdaExecutionRole";

class SharedResources extends cdk.Stack {
  constructor(scope, id, props = {}) {
    super(scope, id, props);

    // S3 bucket creation with removal policy of destroy when the stack is deleted
    this.s3 = new s3.Bucket(this, bucketName, {
      versioned: false,
      bucketName: bucketNameString,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create a vpc where we can launch the server. Deploy to 2 availability zones for the purpose of redundancy
    this.vpc = new ec2.Vpc(this, vpcName, {
      maxAzs: 2,
    });

    // Create the ecs cluster which manages a pool of resources where we can deploy and manage our containerized application.
    // The resources in the vpc are now available to the ECS Cluster
    this.cluster = new ecs.Cluster(this, clusterName, {
      vpc: this.vpc,
      capacity: {
        instanceType: "t3.micro",
      },
    });

    // Create the redis cluster
    this.redis = new ElastiCache(this, cacheName, {
      vpc: this.vpc,
    });
  }
}

class PullyServer extends cdk.Stack {
  constructor(scope, id, props = {}) {
    super(scope, id, props);

    const secret = uuid();
    const appId = randomWords();

    this.serviceName = serviceName;
    this.taskDefinitionName = taskDefinitionName;

    // This defines how a set of Docker containers should behave when they are run together as a task on an ECS cluster.
    this.taskDefinition = new ecs.FargateTaskDefinition(
      this,
      this.taskDefinitionName
    );

    // This adds the container that we want to run as a task. In this case the dockerized pully server.
    const taskContainer = this.taskDefinition.addContainer(containerName, {
      image: ecs.ContainerImage.fromRegistry(`${props.dockerImageName}:latest`),
      memoryLimitMiB: 512,
      environment: {
        REDIS_URL: props.redis.cluster.attrRedisEndpointAddress,
        REDIS_PORT: props.redis.cluster.attrRedisEndpointPort,
        AWS_BUCKET_NAME: props.s3.bucketName,
        REGION: "us-east-1",
        PORT: `${port}`,
        SECRET: secret,
        appId: appId,
      },
      cpu: 256,
      logging: new ecs.AwsLogDriver({
        logGroup: new logs.LogGroup(this, log, {
          logGroupName: "server-log-group",
        }),
        streamPrefix: "server-log-stream",
        createAcl: true,
        destroyLogGroup: true,
      }),
    });

    taskContainer.addPortMappings({
      protocol: ecs.Protocol.TCP, // Use TCP protocol for communication.
      containerPort: port, // Application inside the container should listen on port 80.
    });

    // We are using ec2 instances to run the ecs service. Manages the right number of tasks and ensures they run in the right cluster.
    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      this.serviceName,
      {
        serviceName: this.serviceName,
        cluster: props.cluster,
        taskDefinition: this.taskDefinition,
        desiredCount: 1,
        memoryLimitMiB: 2048,
        publicLoadBalancer: true, // set to true to make the load balancer internet facing.
        cpu: 1024,
      }
    );

    // Create the roles that ECS tasks will assume when they run. Grants full access to aws lambda and s3.
    service.taskDefinition.taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess")
    );
    service.taskDefinition.taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AWSLambda_FullAccess")
    );

    // Set the idle timeout of the load balancer to 60 seconds. This determines how long the ALB will wait for a client to send data before closing the connection.
    service.loadBalancer.setAttribute("idle_timeout.timeout_seconds", "60");

    const scaling = service.service.autoScaleTaskCount({
      minCapacity: 1, // Minimum number of tasks
      maxCapacity: 4, // Maximum number of tasks
    });

    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 50, // Scale in if CPU utilization is below 50%
    });

    scaling.scaleOnMemoryUtilization("MemoryScaling", {
      targetUtilizationPercent: 50, // Scale in if memory utilization is below 50%
    });

    // Create the lambda role for all pully functions to leverage
    const lambdaRole = new iam.Role(this, lambdaExecutionRoleName, {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      roleName: lambdaRoleName,
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess"),
      ],
    });

    const loadBalancerDnsName = service.loadBalancer.loadBalancerDnsName;

    console.log("accountId: ", cdk.Stack.of(this).account);
    console.log("region: ", cdk.Stack.of(this).region);
    console.log("availability zones: ", cdk.Stack.of(this).availabilityZones);

    new cdk.CfnOutput(this, "BucketName", {
      value: props?.s3.bucketName,
    });

    new cdk.CfnOutput(this, "BucketARN", {
      value: props?.s3.bucketArn,
    });

    new cdk.CfnOutput(this, "Lambda Role Arn", {
      value: lambdaRole.roleArn,
    });

    new cdk.CfnOutput(this, "Lambda Role Name", {
      value: lambdaRole.roleName,
    });

    new cdk.CfnOutput(this, "Server URL", {
      value: loadBalancerDnsName,
    });

    new cdk.CfnOutput(this, "JWT Secret", {
      value: secret,
    });

    new cdk.CfnOutput(this, "App ID", {
      value: appId,
    });

    new cdk.CfnOutput(this, "Redis URL", {
      value: props.redis.cluster.attrRedisEndpointAddress,
    });

    new cdk.CfnOutput(this, "Redis Port", {
      value: props.redis.cluster.attrRedisEndpointPort,
    });
  }
}

module.exports = {
  SharedResources,
  PullyServer,
};
