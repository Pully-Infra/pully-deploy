import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";

interface ISharedProps {
  s3: cdk.aws_s3.Bucket;
}

// const bucketNameString = CONFIG.BUCKET_NAME;
const bucketNameString = "CONFIG.BUCKET_NAME";

export class SharedResources extends cdk.Stack {
  public s3: cdk.aws_s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.s3 = new s3.Bucket(this, "PullyBucket", {
      versioned: false,
      bucketName: bucketNameString,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}

export class PullyApp extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props?: cdk.StackProps & ISharedProps
  ) {
    super(scope, id, props);

    new cdk.CfnOutput(this, "BucketARN", {
      value: props?.s3.bucketArn as string,
    });
  }
}
