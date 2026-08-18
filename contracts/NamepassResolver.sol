// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract NamepassResolver {
    address constant FACTORY = 0xe0b155Fdb1104824d7E0568aeAFCC52823EDD00F;

    address public immutable owner;
    address public immutable apexAddr;
    string public avatar;
    string public description;
    string public url;
    string public gatewayUrl;

    error OffchainLookup(
        address sender,
        string[] urls,
        bytes callData,
        bytes4 callbackFunction,
        bytes extraData
    );
    error RegistrationFailed();

    constructor(
        address apexAddr_,
        string memory avatar_,
        string memory description_,
        string memory url_,
        string memory gatewayUrl_
    ) {
        owner = msg.sender;
        apexAddr = apexAddr_;
        avatar = avatar_;
        description = description_;
        url = url_;
        gatewayUrl = gatewayUrl_;
    }

    function resolve(bytes calldata n, bytes calldata d) external view returns (bytes memory) {
        uint256 len = uint8(n[0]);
        bool isApex = n.length == 1 + len + 5;   // `<len> label 03 eth 00`
        bytes4 sig = bytes4(d);

        if (sig == 0xf1cb7e06) {                  // addr(bytes32,uint256)
            uint256 c;
            assembly { c := calldataload(add(d.offset, 36)) }
            if (c != 60 && c >> 31 != 1) return abi.encode(bytes(""));
            if (isApex) return abi.encode(abi.encodePacked(apexAddr));

            bytes calldata label = n[1:1 + len];
            string[] memory urls = new string[](1);
            urls[0] = gatewayUrl;
            revert OffchainLookup(
                address(this),
                urls,
                bytes.concat(bytes(label)),   // gateway registers this label
                this.resolveCallback.selector,
                bytes.concat(bytes(label))    // callback recomputes from this
            );
        }

        if (sig == 0x59d1d43c && isApex) {        // text(bytes32,string) — apex only
            (, string memory key) = abi.decode(d[4:], (bytes32, string));
            bytes32 k = keccak256(bytes(key));
            if (k == keccak256("avatar"))      return abi.encode(avatar);
            if (k == keccak256("description")) return abi.encode(description);
            if (k == keccak256("url"))         return abi.encode(url);
        }

        return abi.encode(bytes(""));
    }

    function resolveCallback(bytes calldata response, bytes calldata extraData)
        external
        pure
        returns (bytes memory)
    {
        // Gateway confirms registration by returning abi-encoded bool true.
        // A non-200 already aborts the read before we reach here; this guards
        // the 200-but-not-saved case. The address is still computed locally,
        // so the gateway can fail the read but never forge an address.
        if (response.length == 0 || !abi.decode(response, (bool))) {
            revert RegistrationFailed();
        }

        bytes32 salt = keccak256(abi.encodePacked(
            keccak256("NAMEPASS_DEPOSIT_WALLET_V1"), keccak256(extraData)
        ));
        address wallet = address(uint160(uint256(keccak256(abi.encodePacked(
            hex"ff", FACTORY, salt,
            keccak256(abi.encodePacked(
                hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", FACTORY,
                hex"5af43d82803e903d91602b57fd5bf3"
            ))
        )))));
        return abi.encode(abi.encodePacked(wallet));
    }

    function supportsInterface(bytes4 x) external pure returns (bool) {
        return x == 0x9061b923 || x == 0x01ffc9a7;
    }
}
