const cdk = require("aws-cdk-lib");
const ElastiCache = require("./elastiCache");
const s3 = require("aws-cdk-lib/aws-s3");
const ecs = require("aws-cdk-lib/aws-ecs");
const ec2 = require("aws-cdk-lib/aws-ec2");
const iam = require("aws-cdk-lib/aws-iam");
const ecsPatterns = require("aws-cdk-lib/aws-ecs-patterns");

const port = 3008;
const vpcName = "PullyVpc";
const cacheName = "PullyRedis";
const bucketName = "PullyBucket";
const serviceName = "PullyService";
const clusterName = "PullyCluster";
const containerName = "PullyContainer";
const lambdaRoleName = "pully-lambda-role";
const bucketNameString = "pully-general-bucket";
const taskDefinitionName = "PullyTaskDefinition";
const dockerImageName = "davetech123/pully-server";
const lambdaExecutionRoleName = "PullyLambdaExecutionRole";

export class SharedResources extends cdk.Stack {
  constructor(scope, id, props) {
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
    // The resources are provided by the vpc
    this.cluster = new ecs.Cluster(this, clusterName, {
      vpc: this.vpc,
    });

    // Create the redis cluster
    this.redis = new ElastiCache(this, cacheName, {
      vpc: this.vpc,
    });
  }
}

export class PullyServer extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // This defines how a set of Docker containers should behave when they are run together as a task on an ECS cluster.
    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      taskDefinitionName
    );

    // This adds the container that we want to run as a task. In this case the dockerized pully server.
    taskDefinition.addContainer(containerName, {
      image: ecs.ContainerImage.fromRegistry(dockerImageName),
      memoryLimitMiB: 512,
      environment: {
        REDIS_URL: props.redis.cluster.attrRedisEndpointAddress,
        AWS_BUCKET_NAME: props.s3.bucketName,
        REGION: "us-east-1",
        PORT: `${port}`,
      },
      cpu: 256,
      portMappings: [
        {
          protocol: ecs.Protocol.TCP, // Use TCP protocol for communication.
          containerPort: port, // Application inside the container should listen on port 80.
          hostPort: 80, // The port on the fargate service should listen on port 80 and forward traffic to the container's port.
        },
      ],
    });

    // We are using ec2 instances to run the ecs service. Manages the right number of tasks and ensures they run in the right cluster.
    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      serviceName,
      {
        serviceName,
        cluster: props.cluster,
        taskDefinition: taskDefinition,
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

    new cdk.CfnOutput(this, "BucketName", {
      value: props?.s3.bucketName,
    });

    new cdk.CfnOutput(this, "BucketARN", {
      value: props?.s3.bucketArn,
    });

    new cdk.CfnOutput(this, "Lambda Role Arn", {
      value: lambdaRole.roleArn,
    });

    new cdk.CfnOutput(this, "Server URL", {
      value: loadBalancerDnsName,
    });
  }
}
