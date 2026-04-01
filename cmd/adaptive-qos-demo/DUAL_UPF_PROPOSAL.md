3GPP TSG-WG SA2 Meeting #173	S2-2600433
Goa, IN, 9th Feb – 13th Feb, 2026	(revision of S2-260xxxx)

Source:	Huawei, HiSilicon
Title:	[KI#4, bullet#2] user plane enhancement
Document for:	Approval
Agenda Item:	20.6.4
Work Item / Release:	FS_6G_ARC / Rel-20
Abstract: Enhancement on UP Architecture to with consideration of service requirements, transmission path quality, session continuity and mobility.
1. Introduction/Discussion
In 6G era, new application services with new QoS requirements emerging and different application services would deployed in different way, e.g. some application services tend to be deployed in a distributed way and close to the user, but other application services (e.g. LLM service that heavily depends on GPU resource) can only deployed in a central way. The 6G user plane architecture is required to support application services with different QoS requirements and deployed in different way.
Operators have deployed UPFs at the metro level, and some of these UPFs may be located near data centres hosting application servers. When a UE accesses an application server located far from the UE's current location, the UPF located near the application server may be considered for the traffic path to reduce the impact of N6 path on transmission quality. Currently, in 5G the ULCL+ PSA UPF mechanism maybe used as a way to reduce the N6 path by selecting a PSA UPF close to the application server, but the ULCL only applies to the case that the application server can be pre-determined and not suitable to the case that the traffic destination cannot be determined until the traffic starts.
In 5G, different UPFs may support different features, for example there are UPFs that support PDU set based handling and UPFs that don't support PDU set based handling, it always assumes that during PDU session establishment the 5GC can determine what kind of traffic might be transmitted via the PDU session and selects the UPF for the PDU session. But in reality, the network may not be able to know in advance which application service the UE will access, so it is better to select an anchor UP function supporting basic functionality and then based on traffic requirements select another UP function supporting required feature.
Also in 5G, after an anchor UPF is selected for each PDU session, the traffic for the UE always passes through the anchor UPF. If a new service is initiated over the current PDU session, this service traffic still needs to go through the anchor UPF even when the UE moves away from the location of the anchor UPF. This may lead to sub-optimal routing issues.

5.4Key Issue #4: User Plane Architecture	
In order to support 6G user plane for a diverse set of applications and traffic patterns, the following are studied taking the 5GS user plane framework as a starting point for discussion: 
1.Whether and how to enhance CP-UP functional split and interaction for better multi-vendor interoperability.	
2.	Whether and how to enhance user plane flexibility (by user plane function (re)selection) for different service requirements, session continuity and mobility with consideration of user plane function capability and path performance between access network and data network.
NOTE 1:This work task may require coordination with RAN WG for user plane interface.	
3.Whether and how to enhance resilience, scalability, and high availability of user plane function. 	
NOTE 2:The outcome of this study may include architectural requirements based on which stage 3 working group can work on the user plane protocols. The stage 3 protocol aspects, including how to design and select user plane protocols, are not in the scope of stage 2.	


2. Text Proposal
It is proposed to capture the following changes vs. TR 23.801-01 v0.3.0.
* * * * First change * * * *
6.0Mapping of Solutions to Key Issues	
Table 6.0-1: Mapping of Solutions to Key Issues
	Key Issues
Solutions	#4																		
#X	x																		
																			

* * * * Second Change * * * *
6.X	Solutions to KI#4
6.X.Y	Solution #X.Y:  Enhancement on UP Architecture
6.X.Y.0 	Topics addressed and High-level Solution Principles
This solution addresses bullet#2 of KI#4: User Plane Architecture. 
2.	Whether and how to enhance user plane flexibility (by user plane function (re)selection) for different service requirements, session continuity and mobility with consideration of user plane function capability and path performance between access network and data network.

The solution provides a design of 6GC user plane architecture and following principles are applied to this solution:
- RAN is connected to UP function and one or more UP functions can be selected for a 6G PDU session.
- UP function can have different capabilities, e.g. UP function can only support basic functionality for traffic anchoring, charging etc, or UP function can support service specific functionality (e.g. PDU set based handling, MoQ Relay functionality, CONNECT-UDP HTTP client functionality etc). During 6G PDU session establishment, a UP function with basic functionality (A-UP) can be selected, and based on application service requirements a service specific UP function (S-UP) can be additionally selected for the 6G PDU session, A-UP detects and forwarding the application service traffic to S-UP for service specific handling.
- Anchor UP functions (A-UP) are to be deployed in a distributed way, and for 6G PDU session, UP function close to UE will be selected as A-UP to enable UE accesses application service in an efficient way.
- To access to application server(s) that are deployed far away from UE, besides the anchor UP, S-UP may be selected between anchor UPF and application server for the traffic to reduce the impacts of N6 path. For UL data packets, the source IP address will be NATed to an IP address anchored at S-UP.
- After movement of UE, agnostic to the UE side, a new A-UP may be selected for branching traffic to old A-UP and acts as IP anchor for locally routed traffic (e.g. new traffic from UE can be anchored at new A-UP).
- Support path performance measurement between UP functions and between UP function and application server, the path measurement results are considered for selection of UP functions for the 6G PDU session.

6.X.Y.1	Description
An illustration of the traffic handling via A-UP and S-UP is shown in Figure 6.X.Y.1.1:
A-UP closes to UE’s location and supports basic UP functionality is selected for the 6G PDU session.
S-UP (Service UP) performs service-related functions and it may be deployed close to application service. A-UP and S-UP can be implemented in a single UP node or separate UP nodes.
When UE moves to a new area, a new A-UP will be additionally added for the 6G PDU session, the new A-UP branching traffic of existing connection to old A-UP and the traffic for new connection will be routed locally, when there is no traffic go via old A-UP, then old A-UP will be released.
 
Figure 6.X.Y.1.1 Illustration of traffic handling via A-UP and S-UP
6.X.Y.2	Procedures
Editor's note:	This clause will describe the high-level procedures and information flows for the solution.
Procedure for traffic transmission
During 6G PDU session establishment, A-UP1 is selected, because it usually not be able to determine which application service traffic will be transmitted via the 6G PDU session and what UP feature is needed for the application service, so a A-UP supporting basic functionality can be selected. 
SCF (Session Control Function) is in charge of IP address allocation and assign the IP address to UE, if the IP address is not allocated from IP address pool of A-UP1. When UE moves, and new A-UP is selected, the IP address can migrate from A-UP1 to the new A-UP. The NAT mechanism may be used at A-UP for traffic routing between A-UP and server.
After the establishment of PDU session anchored at A-UP1, when UE access Application service, a S-UP can be selected for the application service, e.g. to reduce the N6 impact a S-UP close to the application server may be selected for the traffic, or to provide specific treatment (e.g. PDU Set handling) for the traffic a S-UP with dedicated feature (e.g. XRM feature) can be selected.
When UE moves, a new A-UP (i.e. A-UP2) can be selected, the new A-UP can branch traffic of on-going service back to old A-UP (i.e. A-UP1) and also the new A-UP can act as the anchor point for new traffic via NAT. 
UE is not aware of the whether IP is anchored at A-UP1 or A-UP2. 
A topology NF is introduced to maintain a list of candidate UP functions for the services and the path performance measurements related to the UP functions. This information can be subscribed to and used by the A-UP or SCF. The Topology NF can be an independent NF or can be part of other NF (e.g. SCF, Data framework etc).
 
Figure 6.X.Y.2.1 Procedure for traffic transmission with A-UP and S-UP
0. Topo. NF maintains the measurement results. The measurement results are reported by UP functions.
1. Establishment of 6G PDU Session with A-UP, an A-UP close to UE location is selected. SCF is in charge of IP address allocation and assign an IP address to UE, if the IP address is not allocated from IP address pool of A-UP, then A-UP may do NAT translation for the UL data packets if needed.
2. When there is traffic packets for an application service, based on application service requirements a S-UP is selected and the path between A-UP and S-UP is established.
Editor’s Note: How the path between A-UP and S-UP is established is FFS.
After the path between A-UP and S-UP is established, the UL and DL traffic is transmitted via the 6G PDU session and S-UP provides the required service specific treatment.
NOTE：Support the Network AI Agent as described in the Solution (Solution for KI#18), in S2-2600182.
Procedure for selection of new A-UP
SCF may decide to select a new A-UP (e.g. when UE moves to a new area) and traffic for the new connection will be breakout at the new A-UP to avoid route back to the old A-UP. 

  
Figure 6.X.Y.2.2 Procedure for selection of new A-UP
0. UE initiates 6G PDU session establishment procedure. During this procedure, SCF establishes user plane between UE, RAN and source A-UPF (S-A-UP). SCF is in charge of IP address allocation and assign an IP address to UE.
1. SCF determines to select a new target A-UP (T-A-UP), e.g due to UE mobility, the service requirement is not fulfilled or no connection between the RAN and S-A-UP etc.
2. SCF selects T-A-UP.
Editor’s Note: Details about how T-A-UP is selected is FFS.
3. T-A-UP is inserted between RAN and S-A-UP, and user plane path is established from RAN to S-A-UP via T-A-UP. The traffic of existing connection will be routed by T-A-UP to S-A-UP. 
4. If there is no traffic go via S-A-UP, SCF may trigger to release S-A-UP.
NOTE：Support the Network AI Agent as described in the Solution (Solution for KI#18), in S2-2600182.
6.X.Y.3	Services, Entities and Interfaces
Editor's note:	This clause captures impacts on existing services, entities and interfaces.
SCF:
- Session Control related to A-UP and S-UP.
A-UP:
- Path performance measurement between A-UP and S-UP.
- Report the measured path performance to Topo. NF.
- traffic forwarding and branching.
S-UP:
- Path performance measurement between S-UP and application server.
- Report the measured path performance to Topo. NF.
- Packet forwarding between S-UP and A-UP.
- Service specific treatment (e.g. PDU set handling) for application service traffic.
Topo. NF:
- Maintains path performance information.
- Provides path performance information to other NFs.
* * * * End of changes * * * *
