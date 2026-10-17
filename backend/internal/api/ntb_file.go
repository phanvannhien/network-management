package api

// .ntb.json v2 (P1-22, ADR-037): one diagram and everything it uses, in the shape of schema/ntb.schema.json. Refs are
// local to the file — the export writes the objects' ids, the import always makes new ones. No secret is ever here.

type ntbFile struct {
	SchemaVersion  string         `json:"schemaVersion"`
	ExportedAt     string         `json:"exportedAt"`
	Source         *ntbSource     `json:"source,omitempty"`
	Diagram        ntbDiagram     `json:"diagram"`
	Sites          []ntbSite      `json:"sites"`
	Clusters       []ntbCluster   `json:"clusters"`
	Devices        []ntbDevice    `json:"devices"`
	Interfaces     []ntbInterface `json:"interfaces"`
	IPs            []ntbIP        `json:"ips"`
	Subnets        []ntbSubnet    `json:"subnets"`
	Ranges         []ntbRange     `json:"ranges"`
	EndpointGroups []ntbGroup     `json:"endpointGroups"`
	Links          []ntbLink      `json:"links"`
}

type ntbSource struct {
	App          string `json:"app,omitempty"`
	Version      string `json:"version,omitempty"`
	Organization string `json:"organization,omitempty"`
}

type ntbDiagram struct {
	Name        string  `json:"name"`
	Layer       string  `json:"layer"`
	Description string  `json:"description,omitempty"`
	View        ntbView `json:"view"`
}

type ntbView struct {
	Nodes         []ntbNode       `json:"nodes"`
	Edges         []ntbEdge       `json:"edges"`
	Annotations   []ntbAnnotation `json:"annotations"`
	Viewport      *ntbViewport    `json:"viewport,omitempty"`
	LabelTemplate string          `json:"labelTemplate,omitempty"`
	PortStyle     string          `json:"portStyle,omitempty"`
}

type ntbViewport struct {
	X    float32 `json:"x"`
	Y    float32 `json:"y"`
	Zoom float32 `json:"zoom"`
}

type ntbNode struct {
	ID         string            `json:"id"`
	RefKind    string            `json:"refKind"`
	RefID      string            `json:"refId"`
	X          float32           `json:"x"`
	Y          float32           `json:"y"`
	Width      *float32          `json:"width,omitempty"`
	Height     *float32          `json:"height,omitempty"`
	Locked     *bool             `json:"locked,omitempty"`
	LabelStyle map[string]string `json:"labelStyle,omitempty"`
}

type ntbPoint struct {
	X float32 `json:"x"`
	Y float32 `json:"y"`
}

type ntbEdge struct {
	ID        string     `json:"id"`
	LinkRef   string     `json:"linkRef"`
	Routing   string     `json:"routing,omitempty"`
	Waypoints []ntbPoint `json:"waypoints,omitempty"`
}

type ntbAnnotation struct {
	ID        string     `json:"id"`
	Kind      string     `json:"kind"`
	X         float32    `json:"x"`
	Y         float32    `json:"y"`
	Width     *float32   `json:"width,omitempty"`
	Height    *float32   `json:"height,omitempty"`
	Text      string     `json:"text,omitempty"`
	Color     string     `json:"color,omitempty"`
	FontSize  *float32   `json:"fontSize,omitempty"`
	Points    []ntbPoint `json:"points,omitempty"`
	SiteRef   *string    `json:"siteRef,omitempty"`
	LineStyle string     `json:"lineStyle,omitempty"`
}

type ntbSite struct {
	Ref  string `json:"ref"`
	Code string `json:"code"`
	Name string `json:"name"`
}

type ntbCluster struct {
	Ref      string `json:"ref"`
	SiteRef  string `json:"siteRef"`
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	Hostname string `json:"hostname,omitempty"`
	MgmtIP   string `json:"mgmtIp,omitempty"`
	Notes    string `json:"notes,omitempty"`
}

type ntbDevice struct {
	Ref              string   `json:"ref"`
	SiteRef          string   `json:"siteRef"`
	Hostname         string   `json:"hostname"`
	Type             string   `json:"type"`
	Vendor           string   `json:"vendor,omitempty"`
	Model            string   `json:"model,omitempty"`
	PartNumber       string   `json:"partNumber,omitempty"`
	SerialNumber     string   `json:"serialNumber,omitempty"`
	AssetTag         string   `json:"assetTag,omitempty"`
	Firmware         string   `json:"firmware,omitempty"`
	Role             string   `json:"role,omitempty"`
	Lifecycle        string   `json:"lifecycle,omitempty"`
	Managed          *bool    `json:"managed,omitempty"`
	OwnerName        string   `json:"ownerName,omitempty"`
	Notes            string   `json:"notes,omitempty"`
	Tags             []string `json:"tags,omitempty"`
	UHeight          int32    `json:"uHeight,omitempty"`
	CatalogID        string   `json:"catalogId,omitempty"`
	ClusterRef       *string  `json:"clusterRef,omitempty"`
	ClusterRole      *string  `json:"clusterRole,omitempty"`
	ClusterMemberNo  *int32   `json:"clusterMemberNo,omitempty"`
	MgmtInterfaceRef *string  `json:"mgmtInterfaceRef,omitempty"`
}

type ntbInterface struct {
	Ref          string  `json:"ref"`
	DeviceRef    string  `json:"deviceRef"`
	Name         string  `json:"name"`
	Kind         string  `json:"kind"`
	Media        string  `json:"media,omitempty"`
	Speed        string  `json:"speed,omitempty"`
	Duplex       string  `json:"duplex,omitempty"`
	Mode         string  `json:"mode,omitempty"`
	AccessVlan   *int32  `json:"accessVlan,omitempty"`
	NativeVlan   *int32  `json:"nativeVlan,omitempty"`
	AllowedVlans string  `json:"allowedVlans,omitempty"`
	Poe          bool    `json:"poe,omitempty"`
	LagRef       *string `json:"lagRef,omitempty"`
	Description  string  `json:"description,omitempty"`
	AdminUp      *bool   `json:"adminUp,omitempty"`
	MAC          *string `json:"mac,omitempty"`
	VlanTag      *int32  `json:"vlanTag,omitempty"`
}

type ntbIP struct {
	DeviceRef    string  `json:"deviceRef"`
	InterfaceRef *string `json:"interfaceRef,omitempty"`
	Address      string  `json:"address"`
	Vrf          string  `json:"vrf,omitempty"`
	Role         string  `json:"role"`
	Description  string  `json:"description,omitempty"`
}

type ntbSubnet struct {
	Ref         string  `json:"ref"`
	SiteRef     *string `json:"siteRef,omitempty"`
	Cidr        string  `json:"cidr"`
	Vrf         string  `json:"vrf,omitempty"`
	Gateway     string  `json:"gateway,omitempty"`
	Description string  `json:"description,omitempty"`
}

type ntbRange struct {
	Ref       string `json:"ref"`
	SubnetRef string `json:"subnetRef"`
	StartIP   string `json:"startIp"`
	EndIP     string `json:"endIp"`
	Kind      string `json:"kind"`
	Purpose   string `json:"purpose,omitempty"`
}

type ntbGroup struct {
	Ref           string  `json:"ref"`
	SiteRef       string  `json:"siteRef"`
	Kind          string  `json:"kind"`
	Name          string  `json:"name"`
	ExpectedCount *int32  `json:"expectedCount,omitempty"`
	RangeRef      *string `json:"rangeRef,omitempty"`
	Notes         string  `json:"notes,omitempty"`
}

type ntbEnd struct {
	Kind         string  `json:"kind"`
	Ref          string  `json:"ref"`
	InterfaceRef *string `json:"interfaceRef,omitempty"`
}

type ntbLink struct {
	Ref       string   `json:"ref"`
	Kind      string   `json:"kind"`
	A         ntbEnd   `json:"a"`
	B         ntbEnd   `json:"b"`
	Medium    string   `json:"medium,omitempty"`
	Speed     string   `json:"speed,omitempty"`
	LengthM   *float32 `json:"lengthM,omitempty"`
	CableID   string   `json:"cableId,omitempty"`
	Status    string   `json:"status,omitempty"`
	FiberMode string   `json:"fiberMode,omitempty"`
	Connector string   `json:"connector,omitempty"`
	Service   string   `json:"service,omitempty"`
	Provider  string   `json:"provider,omitempty"`
	CircuitID string   `json:"circuitId,omitempty"`
	Bandwidth string   `json:"bandwidth,omitempty"`
	Notes     string   `json:"notes,omitempty"`
}
