// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {NamepassFactory} from "../contracts/NamepassFactory.sol";
import {MockUSDC} from "./mocks/Mocks.sol";

contract ArcTestMessenger {
    function localMinter() external view returns (address) { return address(this); }
    function burnLimitsPerMessage(address) external pure returns (uint256) { return 1_000_000_000; }
    function depositForBurnWithHook(uint256 amount, uint32, bytes32, address token, bytes32, uint256, uint32, bytes calldata) external {
        MockUSDC(token).transferFrom(msg.sender, address(this), amount);
    }
}

contract ArcDepositTest is Test {
    NamepassFactory factory;
    MockUSDC token;
    ArcTestMessenger messenger;
    address wallet;

    function setUp() public {
        vm.chainId(5042002);
        factory = new NamepassFactory(address(this), 11155111);
        token = new MockUSDC();
        messenger = new ArcTestMessenger();
        factory.initialize(address(token), address(messenger), address(0x1234));
        wallet = factory.predictWallet("steve");
        vm.deal(address(this), 10 ether);
    }

    function test_nativeDepositBeforeAndAfterRealWalletDeployment() public {
        assertEq(wallet.code.length, 0);
        (bool first,) = wallet.call{value: 1 ether}("");
        assertTrue(first);
        // Foundry does not implement Arc's native/ERC20 balance mapping.
        // Model the token balance separately; verify the real mapping on Arc.
        token.mint(wallet, 1_000_000);
        factory.renew("steve");
        assertGt(wallet.code.length, 0);
        bytes32 codeHash = wallet.codehash;
        (bool second,) = wallet.call{value: 1 ether}("");
        assertTrue(second);
        assertEq(wallet.balance, 2 ether);
        token.mint(wallet, 1_000_000);
        factory.renew("steve");
        assertEq(token.balanceOf(wallet), 0);
        assertEq(token.balanceOf(address(messenger)), 2_000_000);
        assertEq(token.allowance(wallet, address(messenger)), 0);
        assertEq(factory.predictWallet("steve"), wallet);
        assertEq(wallet.codehash, codeHash);
    }

    function _deployWallet() private {
        token.mint(wallet, 1_000_000);
        factory.renew("steve");
    }

    function test_rejectsFactoryNativeDepositsAndUnknownCalldata() public {
        _deployWallet();
        (bool direct,) = address(factory).call{value: 1 ether}("");
        assertFalse(direct);
        (bool unknown,) = wallet.call{value: 1 ether}(hex"deadbeef");
        assertFalse(unknown);
    }

    function test_nativeReceptionDoesNotAuthorizeExecution() public {
        _deployWallet();
        token.mint(wallet, 1_000_000);
        (bool ok,) = wallet.call(abi.encodeCall(factory.execute, ("steve", 1_000_000, 0, address(this))));
        assertFalse(ok);
        assertEq(token.balanceOf(wallet), 1_000_000);
    }

    function test_rejectsNativeDepositsOnOtherSupportedChains() public {
        _deployWallet();
        uint256[6] memory chains = [uint256(1), 11155111, 8453, 84532, 42161, 421614];
        for (uint256 i; i < chains.length; ++i) {
            vm.chainId(chains[i]);
            (bool ok,) = wallet.call{value: 1 ether}("");
            assertFalse(ok);
        }
    }
}
