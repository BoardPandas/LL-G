---
tech: azure
tags: [azure, arm, networking, vpn-gateway, virtualnetworkgateway, gatewaysubnet, invalidresourcereference, az-powershell, invoke-azrestmethod]
severity: medium
---
# InvalidResourceReference for GatewaySubnet is an ARM gateway deploy failing validation, not a broken gateway

## PROBLEM
A VNet/VPN gateway deployment fails with:

```
Resource .../subnets/GatewaySubnet referenced by resource .../virtualNetworkGateways/<name> was not found. (Code: InvalidResourceReference)
```

This is frequently misreported as a "Graph API" error because it surfaces in an M365/Azure admin context, but it is a pure Azure Resource Manager (ARM) error and has nothing to do with Microsoft Graph.

Root cause: Azure requires every VNet/VPN/ExpressRoute gateway to bind to a subnet named exactly `GatewaySubnet` (case-sensitive, literal name). If that subnet does not exist in the target VNet, ARM rejects the gateway deployment at validation time. Critically, the gateway resource itself ends up NOT created (a GET on the gateway returns HTTP 404), so this is a deploy-time validation failure, not a corrupted/broken existing gateway. Don't go hunting for a damaged gateway to repair; there isn't one.

Diagnosis (read-only, works with just the `Az.Accounts` module via `Invoke-AzRestMethod`, no `Az.Network` install needed):
1. GET the VNet and list `properties.subnets`: confirm `GatewaySubnet` is absent.
2. GET `virtualNetworkGateways/<name>`: a 404 confirms the gateway never deployed (validation blocked it).
3. Confirm the SP can write: GET `.../resourceGroups/<rg>/providers/Microsoft.Authorization/permissions`. Contributor shows `Actions: *` with `Microsoft.Authorization/*/Write` etc. in `NotActions`.

## WRONG
```powershell
# Misreading it as a Graph/M365 problem, or trying to "repair" a gateway that
# was never created. Also: a full-VNet PUT to add the subnet risks clobbering
# existing subnets if the payload omits them.
$body = '{ "properties": { "addressSpace": { "addressPrefixes": ["10.123.0.0/16"] },
  "subnets": [ { "name": "GatewaySubnet", "properties": { "addressPrefix": "10.123.255.0/27" } } ] } }'
Invoke-AzRestMethod -Path "/subscriptions/$sub/resourceGroups/$rg/providers/Microsoft.Network/virtualNetworks/$vnet?api-version=2023-09-01" -Method PUT -Payload $body
# ^ 'default' and any other existing subnets are now gone because they were not in the payload.
```

## RIGHT
```powershell
# Surgical child-resource PUT: adds ONLY GatewaySubnet, cannot disturb existing subnets.
$path = "/subscriptions/$sub/resourceGroups/$rg/providers/Microsoft.Network/virtualNetworks/$vnet/subnets/GatewaySubnet?api-version=2023-09-01"
$body = '{ "properties": { "addressPrefix": "10.123.255.0/27" } }'
$r = Invoke-AzRestMethod -Path $path -Method PUT -Payload $body   # expect HTTP 201

# Poll provisioningState until Succeeded, then re-run the gateway deployment.
# Name MUST be exactly "GatewaySubnet". Use /27 or larger; avoid /29 (blocks
# future coexistence: VPN+ExpressRoute, active-active). Pick a CIDR inside the
# VNet address space that does not overlap existing subnets.
```

## NOTES
- A Graph-scoped service principal (one provisioned for M365 automation) may also happen to hold an Azure RBAC role on the subscription/RG. These are separate authorization planes. Connect to ARM with `Connect-AzAccount -ServicePrincipal -CertificateThumbprint ...`, then verify effective permissions via the `Microsoft.Authorization/permissions` endpoint before assuming write access.
- After the subnet exists, the original `InvalidResourceReference` clears and the gateway provisions normally. VNet gateway provisioning typically takes 20-45 minutes.
- Next most common deploy failure after the missing subnet is a missing/region-mismatched public IP referenced by the gateway, so verify the PIP exists in the same region/RG.
