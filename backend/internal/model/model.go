// Package model defines the Go structs for the .ntb.json project file format.
// They must stay in sync with schema/ntb.schema.json (the single source of truth);
// the round-trip test in model_test.go validates them against every file in /testdata.
package model

import "encoding/json"

// ProjectFile is the top-level document of a .ntb.json file.
type ProjectFile struct {
	SchemaVersion string   `json:"schemaVersion"`
	Project       Project  `json:"project"`
	VLANs         []VLAN   `json:"vlans"`
	Subnets       []Subnet `json:"subnets"`
	Devices       []Device `json:"devices"`
	Links         []Link   `json:"links"`
	Groups        []Group  `json:"groups"`
	Assets        []Asset  `json:"assets"`
	Pages         []Page   `json:"pages"`
}

type Project struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Author    string `json:"author,omitempty"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type VLAN struct {
	ID        string   `json:"id"`
	VLANID    int      `json:"vlanId"`
	Name      string   `json:"name"`
	Color     string   `json:"color,omitempty"`
	SubnetIDs []string `json:"subnetIds,omitempty"`
}

type Subnet struct {
	ID      string `json:"id"`
	CIDR    string `json:"cidr"`
	Gateway string `json:"gateway,omitempty"`
	VRF     string `json:"vrf,omitempty"`
}

type Device struct {
	ID           string            `json:"id"`
	Type         string            `json:"type"`
	Hostname     string            `json:"hostname"`
	Vendor       string            `json:"vendor,omitempty"`
	Model        string            `json:"model,omitempty"`
	Role         string            `json:"role,omitempty"`
	Lifecycle    string            `json:"lifecycle,omitempty"`
	MgmtIP       string            `json:"mgmtIp,omitempty"`
	Site         string            `json:"site,omitempty"`
	Rack         *RackPosition     `json:"rack,omitempty"`
	CustomFields map[string]any    `json:"customFields"`
	Monitoring   *MonitoringConfig `json:"monitoring,omitempty"`
	Interfaces   []Interface       `json:"interfaces"`
}

type RackPosition struct {
	RackID string `json:"rackId"`
	Unit   int    `json:"unit"`
	Height int    `json:"height,omitempty"`
}

type MonitoringConfig struct {
	Enabled           bool    `json:"enabled"`
	SnmpProfileID     *string `json:"snmpProfileId"`
	PollerID          string  `json:"pollerId"`
	DependsOnDeviceID *string `json:"dependsOnDeviceId"`
}

type Interface struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Media        string   `json:"media"`
	Speed        string   `json:"speed"`
	Mode         string   `json:"mode,omitempty"`
	AccessVlan   int      `json:"accessVlan,omitempty"`
	AllowedVlans *[]int   `json:"allowedVlans,omitempty"`
	IPAddresses  []string `json:"ipAddresses"`
	PoE          bool     `json:"poe"`
	LagID        *string  `json:"lagId"`
	AdminUp      bool     `json:"adminUp"`
	IfIndex      *int     `json:"ifIndex"`
}

type Link struct {
	ID      string   `json:"id"`
	Kind    string   `json:"kind"`
	Medium  string   `json:"medium,omitempty"`
	Speed   string   `json:"speed,omitempty"`
	Status  string   `json:"status,omitempty"`
	A       Endpoint `json:"a"`
	B       Endpoint `json:"b"`
	LengthM *float64 `json:"lengthM,omitempty"`
	CableID string   `json:"cableId,omitempty"`
	Notes   string   `json:"notes"`
}

type Endpoint struct {
	DeviceID    string `json:"deviceId"`
	InterfaceID string `json:"interfaceId"`
}

type Group struct {
	ID        string   `json:"id"`
	Kind      string   `json:"kind"`
	Name      string   `json:"name"`
	MemberIDs []string `json:"memberIds"`
	ParentID  *string  `json:"parentId"`
}

type Asset struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	MIME string `json:"mime"`
	Data string `json:"data"`
}

type Page struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Layer         string    `json:"layer"`
	Nodes         []Node    `json:"nodes"`
	Edges         []Edge    `json:"edges"`
	Viewport      *Viewport `json:"viewport,omitempty"`
	LabelTemplate string    `json:"labelTemplate,omitempty"`
}

type Node struct {
	RefID       string  `json:"refId"`
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	IconAssetID *string `json:"iconAssetId"`
	Locked      bool    `json:"locked"`
}

type Edge struct {
	RefID     string     `json:"refId"`
	Routing   string     `json:"routing"`
	Waypoints []Waypoint `json:"waypoints"`
}

type Waypoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type Viewport struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Zoom float64 `json:"zoom"`
}

// Parse decodes a .ntb.json document.
func Parse(data []byte) (*ProjectFile, error) {
	var f ProjectFile
	if err := json.Unmarshal(data, &f); err != nil {
		return nil, err
	}
	return &f, nil
}
