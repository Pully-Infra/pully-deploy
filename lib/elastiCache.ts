import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elasticache from "aws-cdk-lib/aws-elasticache";

interface IElastiCache {
  vpc: cdk.aws_ec2.Vpc;
}

const subnetGroup = "RedisSubnetGroup";
const securityGroup = "RedisSecurityGroup";
const cacheClusterName = "PullyRedisCluster";
const subnetGroupName = "PullyRedisSubnetGroup";

class ElastiCache extends cdk.Stack {
  public securityGroup: cdk.aws_ec2.SecurityGroup;
  public cluster: cdk.aws_elasticache.CfnCacheCluster;

  constructor(
    scope: Construct,
    id: string,
    props?: cdk.StackProps & IElastiCache
  ) {
    super(scope, id, props);

    const vpc = props?.vpc as cdk.aws_ec2.Vpc;

    const privateSubnetIds = (vpc?.privateSubnets || []).map(
      (subnet) => subnet.subnetId
    );

    // Create subnet group
    const subnetGroups = new elasticache.CfnSubnetGroup(this, subnetGroup, {
      cacheSubnetGroupName: subnetGroupName,
      subnetIds: privateSubnetIds,
      description:
        "The subnet group within the vpc where the redis is deployed",
    });

    // Create a security group to set inbound / outbound rules on the vpc
    const vpcSecurityGroup = new ec2.SecurityGroup(this, securityGroup, {
      vpc,
      allowAllOutbound: true,
    });

    // Set an ingress rule to specify which port can allow incoming traffic
    vpcSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(6379));

    const cacheCluster = new elasticache.CfnCacheCluster(
      this,
      cacheClusterName,
      {
        engine: "redis",
        numCacheNodes: 1,
        cacheNodeType: "cache.t3.micro",
        cacheSubnetGroupName: subnetGroups.cacheSubnetGroupName,
        vpcSecurityGroupIds: [vpcSecurityGroup.securityGroupId],
      }
    );

    this.securityGroup = vpcSecurityGroup;
    this.cluster = cacheCluster;

    new cdk.CfnOutput(this, "Redis URL", {
      value: cacheCluster.attrRedisEndpointAddress,
    });
  }
}

export default ElastiCache;
