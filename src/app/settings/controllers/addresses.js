angular.module('proton.settings')
.controller('AddressesController', (
    $q,
    $rootScope,
    $scope,
    $state,
    gettextCatalog,
    Address,
    activateOrganizationModal,
    addressModal,
    authentication,
    confirmModal,
    identityModal,
    CONSTANTS,
    domainApi,
    domainModel,
    eventManager,
    generateModal,
    generateOrganizationModal,
    memberModal,
    memberModel,
    networkActivityTracker,
    notify,
    organizationApi,
    organizationModel,
    organizationKeysModel,
    pmcw
) => {
    const unsubscribes = [];
    const role = authentication.user.Role;

    function addressesInit() {
        $scope.isSubUser = authentication.user.subuser;
        $scope.activeAddresses = _.where(authentication.user.Addresses, { Status: 1, Receive: 1 });
        $scope.disabledAddresses = _.difference(authentication.user.Addresses, $scope.activeAddresses);
        $scope.itemMoved = false;
        $scope.keyStatus = 0;
        $scope.members = memberModel.get();
        $scope.organization = organizationModel.get();
        $scope.domains = domainModel.get();
        manageOrganizationKeys()
        .then(() => checkActivationKeys());
    }

    function checkActivationKeys() {
        if (CONSTANTS.KEY_PHASE > 3 && $scope.organization.HasKeys === 1 && $scope.keyStatus > 0) {
            $scope.activateOrganizationKeys();
        }
    }

    function manageOrganizationKeys() {
        if (authentication.user.Role === CONSTANTS.PAID_ADMIN_ROLE) {
            const keys = organizationKeysModel.get();

            if (keys.PublicKey) {
                $scope.keyStatus = 0;
                pmcw.keyInfo(keys.PublicKey)
                .then((obj) => ($scope.organizationKeyInfo = obj));
            }

            if (!keys.PrivateKey) {
                $scope.keyStatus = 1;
                return Promise.resolve();
            }

            return pmcw.decryptPrivateKey(keys.PrivateKey, authentication.getPassword())
            .then((key) => ($scope.organizationKey = key), (error) => {
                $scope.keyStatus = 2;
                console.error(error);
            });
        }

        return Promise.resolve();
    }

    $scope.getSelf = () => {
        if ($scope.members) {
            return $scope.members.filter((member) => member.Self)[0];
        }
    };

    $scope.canAddAddress = () => {
        if ($scope.organization.MaxAddresses - $scope.organization.UsedAddresses < 1) {
            notify({ message: gettextCatalog.getString('You have used all addresses in your plan. Please upgrade your plan to add a new address', null, 'Error'), classes: 'notification-danger' });
            return 0;
        }

        if ($scope.keyStatus > 0 && CONSTANTS.KEY_PHASE > 3) {
            notify({ message: gettextCatalog.getString('Administrator privileges must be activated', null, 'Error'), classes: 'notification-danger' });
            $state.go('secured.members');
            return;
        }

        return 1;
    };

    /**
     * Check organization status to know if the user can add a member
     * @return {Boolean}
     */
    $scope.canAddMember = () => {
        const organization = organizationModel.get();

        if (organization.MaxMembers === 1 && CONSTANTS.KEY_PHASE > 3) {
            notify({ message: gettextCatalog.getString('Multi-user support requires either a Business or Visionary plan.', null, 'Error'), classes: 'notification-danger' });
            $state.go('secured.members');
            return false;
        }

        if (organization.MaxMembers - organization.UsedMembers < 1) {
            notify({ message: gettextCatalog.getString('You have used all members in your plan. Please upgrade your plan to add a new member.', null, 'Error'), classes: 'notification-danger' });
            return false;
        }

        if (organization.MaxAddresses - organization.UsedAddresses < 1) {
            notify({ message: gettextCatalog.getString('You have used all addresses in your plan. Please upgrade your plan to add a new member.', null, 'Error'), classes: 'notification-danger' });
            return false;
        }

        if (organization.MaxSpace - organization.AssignedSpace < 1) {
            notify({ message: gettextCatalog.getString('All storage space has been allocated. Please reduce storage allocated to other members.', null, 'Error'), classes: 'notification-danger' });
            return false;
        }

        if ($scope.keyStatus > 0 && CONSTANTS.KEY_PHASE > 3) {
            notify({ message: gettextCatalog.getString('Permission denied, administrator privileges have been restricted.', null, 'Error'), classes: 'notification-danger' });
            $state.go('secured.members');
            return false;
        }

        return true;
    };

    // Listeners
    if (role === 2) {
        unsubscribes.push($rootScope.$on('organizationChange', (event, newOrganization) => {
            $scope.organization = newOrganization;
            organizationKeysModel.fetch()
            .then(() => manageOrganizationKeys());
        }));

        unsubscribes.push($rootScope.$on('membersChange', (event, newMembers) => {
            $scope.members = newMembers;
        }));

        unsubscribes.push($rootScope.$on('domainsChange', (event, newDomains) => {
            $scope.domains = newDomains;
        }));
    }

    $scope.$on('$destroy', () => {
        unsubscribes.forEach((callback) => callback());
    });

    // Drag and Drop configuration
    $scope.aliasDragControlListeners = {
        containment: '.pm_form',
        accept(sourceItemHandleScope, destSortableScope) {
            return sourceItemHandleScope.itemScope.sortableScope.$id === destSortableScope.$id;
        },
        dragStart() {
            $scope.itemMoved = true;
        },
        dragEnd() {
            $scope.itemMoved = false;
        },
        orderChanged() {
            const addresses = $scope.activeAddresses.concat($scope.disabledAddresses);
            const order = [];

            _.each(addresses, (address, index) => {
                order[index] = address.Send;
                address.Send = index + 1;
            });

            $scope.saveOrder(order);
        }
    };

    // Listeners
    $scope.$on('updateUser', () => {
        if ($scope.itemMoved === false) {
            $scope.activeAddresses = _.where(authentication.user.Addresses, { Status: 1, Receive: 1 });
            $scope.disabledAddresses = _.difference(authentication.user.Addresses, $scope.activeAddresses);
        }

        if (authentication.user.Role !== role) {
            $state.go('secured.addresses');
        }
    });

    // $scope.$on('createUser', () => {
    //     notify({ message: gettextCatalog.getString('Address created', null, 'Info'), classes: 'notification-success' });
    // });

    /**
     * Return domain value for a specific address
     * @param {Object} address
     * @return {String} domain
     */
    $scope.getDomain = (address) => {
        const email = address.Email.split('@');

        return email[1];
    };

    function disableAddress(addressID) {
        return Address.disable(addressID)
        .then(({ data = {} } = {}) => {
            if (data.Code === 1000) {
                return Promise.resolve();
            }
            if (data.Error) {
                return Promise.resolve(data.Error);
            }
            return Promise.reject(gettextCatalog.getString('Error during disable request', null, 'Error'));
        });
    }

    function enableAddress(addressID) {
        return Address.enable(addressID)
        .then(({ data = {} } = {}) => {
            if (data.Code === 1000) {
                return Promise.resolve();
            }
            if (data.Error) {
                return Promise.resolve(data.Error);
            }
            return Promise.reject(gettextCatalog.getString('Error during enable request', null, 'Error'));
        });
    }

    function deleteAddress(addressID) {
        return Address.delete(addressID)
        .then(({ data = {} } = {}) => {
            if (data.Code === 1000) {
                return Promise.resolve();
            }
            if (data.Error) {
                return Promise.resolve(data.Error);
            }
            return Promise.reject(gettextCatalog.getString('Error during deletion', null, 'Error'));
        });
    }

    /**
     * Delete address
     * @param {Object} address
     * @param {Object} domain
     */
    $scope.deleteAddress = (address = {}, domain = {}) => {
        const addressID = address.ID;
        const title = gettextCatalog.getString('Delete address', null, 'Title');
        const message = gettextCatalog.getString('Are you sure you want to delete this address?', null, 'Info');

        confirmModal.activate({
            params: {
                title,
                message,
                confirm() {
                    const promise = disableAddress(addressID)
                    .then(() => deleteAddress(addressID))
                    .then(() => eventManager.call())
                    .then(() => {
                        notify({ message: gettextCatalog.getString('Address deleted', null, 'Info'), classes: 'notification-success' });
                        confirmModal.deactivate();
                    });

                    networkActivityTracker.track(promise);
                },
                cancel() {
                    confirmModal.deactivate();
                }
            }
        });
    };

    /**
     * Enable an address
     */
    $scope.enableAddress = (address) => {
        const addressID = address.ID;
        const promise = enableAddress(addressID)
        .then(() => eventManager.call())
        .then(() => notify({ message: gettextCatalog.getString('Address enabled', null, 'Info'), classes: 'notification-success' }));

        networkActivityTracker.track(promise);
    };

    /**
     * Open a modal to disable an address
     */
    $scope.disableAddress = (address) => {
        const addressID = address.ID;
        const title = gettextCatalog.getString('Disable address', null, 'Title');
        const message = gettextCatalog.getString('Are you sure you want to disable this address?', null, 'Info');

        confirmModal.activate({
            params: {
                title,
                message,
                confirm() {
                    const promise = disableAddress(addressID)
                    .then(() => eventManager.call())
                    .then(() => notify({ message: gettextCatalog.getString('Address disabled', null, 'Info'), classes: 'notification-success' }));

                    networkActivityTracker.track(promise);
                },
                cancel() {
                    confirmModal.deactivate();
                }
            }
        });
    };

    /**
     * Open modal to add a new address, used by domains and members controllers
     */
    $scope.addAddress = (domain, member) => {
        let showMember = true;
        let domains = $scope.domains;
        let members = $scope.members;

        if (domain) {
            domains = [domain];
        }

        if (member) {
            members = [member];

            // Do not show Add Member button if specific member requested
            showMember = false;
        }

        if (!domains || domains.length === 0) {
            $state.go('secured.domains');
            return;
        }

        if (!$scope.canAddAddress()) {
            return;
        }

        const memberParams = {
            params: {
                organization: $scope.organization,
                organizationKey: $scope.organizationKey,
                domains,
                submit() {
                    memberModal.deactivate();
                },
                cancel() {
                    memberModal.deactivate();
                }
            }
        };

        addressModal.activate({
            params: {
                domains,
                members,
                organizationKey: $scope.organizationKey,
                showMember,
                addMember() {
                    if (!$scope.canAddMember()) {
                        return;
                    }

                    addressModal.deactivate();
                    memberModal.activate(memberParams);
                },
                submit() {
                    addressModal.deactivate();
                    eventManager.call();
                },
                cancel() {
                    addressModal.deactivate();
                }
            }
        });
    };

    /**
     * Open a modal to edit an address
     */
    $scope.identity = (address) => {
        identityModal.activate({
            params: {
                title: gettextCatalog.getString('Edit address', null, 'Title'),
                address,
                confirm(address) {
                    if (address.custom === false) {
                        address.DisplayName = null;
                        address.Signature = null;
                    }

                    networkActivityTracker.track(
                        Address.edit(address.ID, { DisplayName: address.DisplayName, Signature: address.Signature })
                        .then((result) => {
                            if (angular.isDefined(result.data) && result.data.Code === 1000) {
                                eventManager.call();
                                notify({ message: gettextCatalog.getString('Address updated', null, 'Info'), classes: 'notification-success' });
                                identityModal.deactivate();
                            } else if (angular.isDefined(result.data) && result.data.Error) {
                                notify({ message: result.data.Error, classes: 'notification-danger' });
                            } else {
                                notify({ message: gettextCatalog.getString('Error during updating', null, 'Error'), classes: 'notification-danger' });
                            }
                        }, () => {
                            notify({ message: gettextCatalog.getString('Error during updating', null, 'Error'), classes: 'notification-danger' });
                        })
                    );
                },
                cancel() {
                    identityModal.deactivate();
                }
            }
        });
    };

    /**
     * Open modal to fix keys
     * @param {Object} address
     */
    $scope.generate = (address) => {
        const title = gettextCatalog.getString('Generate key pair', null, 'Title');
        const message = gettextCatalog.getString('Generate key pair', null, 'Info');

        generateModal.activate({
            params: {
                title,
                message,
                addresses: [address],
                password: authentication.getPassword(),
                close(success) {
                    if (success) {
                        eventManager.call();
                    }

                    generateModal.deactivate();
                }
            }
        });
    };

    $scope.addAlias = () => {

        const self = $scope.getSelf();
        if (self.Type !== 0) {
            notify({ message: gettextCatalog.getString('Only users with existing ProtonMail addresses can add ProtonMail aliases', null, 'Error'), classes: 'notification-danger' });
            return;
        }

        if (!$scope.canAddAddress()) {
            return;
        }

        networkActivityTracker.track(

            domainApi.available()
            .then((availableDomains) => {

                const pmDomains = availableDomains.data.Domains.map((domain) => ({ DomainName: domain }));

                addressModal.activate({
                    params: {
                        domains: pmDomains,
                        members: [self],
                        organizationKey: {}, // Aliases not for sub-users
                        submit() {
                            addressModal.deactivate();
                            eventManager.call();
                        },
                        cancel() {
                            addressModal.deactivate();
                        }
                    }
                });
            })
        );
    };

    $scope.saveOrder = (order) => {
        networkActivityTracker.track(
            Address.order({ Order: order })
            .then((result) => {
                if (result.data && result.data.Code === 1000) {
                    notify({ message: gettextCatalog.getString('Order saved', null, 'Info'), classes: 'notification-success' });
                } else if (result.data && result.data.Error) {
                    notify({ message: result.data.Error, classes: 'notification-danger' });
                } else {
                    notify({ message: gettextCatalog.getString('Unable to save your changes, please try again.', null, 'Error'), classes: 'notification-danger' });
                }
            })
        );
    };

    $scope.activateOrganizationKeys = () => {

        let params;
        if ($scope.keyStatus === 1) {
            params = {
                title: gettextCatalog.getString('Key Activation', null, 'Title'),
                prompt: gettextCatalog.getString('Organization password:', null, 'Label'),
                message: gettextCatalog.getString('You must activate your organization private key with the backup organization key password provided to you by your organization administrator.', null, 'Info'),
                alert: gettextCatalog.getString('Without activation you will not be able to create new users, add addresses to existing users, or access non-private user accounts.', null, 'Info'),
                successMessage: gettextCatalog.getString('Organization keys activated', null, 'Info'),
                errorMessage: gettextCatalog.getString('Error activating organization keys', null, 'Error'),
                alertClass: 'alert alert-warning'
            };
        } else if ($scope.keyStatus === 2) {
            params = {
                title: gettextCatalog.getString('Restore Administrator Privileges', null, 'Title'),
                prompt: gettextCatalog.getString('Organization password:', null, 'Label'),
                message: gettextCatalog.getString('Enter the Organization Password to restore administrator privileges. <a href="https://protonmail.com/support/knowledge-base/restore-administrator/" target="_blank">Learn more</a>', null, 'Info'),
                alert: gettextCatalog.getString('If another administrator changed this password, you will need to ask them for the new Organization Password.', null, 'Info'),
                successMessage: gettextCatalog.getString('Organization keys restored', null, 'Info'),
                errorMessage: gettextCatalog.getString('Error restoring organization keys', null, 'Error'),
                reset() {
                    activateOrganizationModal.deactivate();
                    $scope.changeOrganizationKeys();
                }
            };
        } else {
            notify({ message: gettextCatalog.getString('Organization keys already active', null, 'Error'), classes: 'notification-success' });
            return;
        }

        _.extend(params, {
            submit(pkg) {

                $scope.keyStatus = 0;
                $scope.organizationKey = pkg;

                activateOrganizationModal.deactivate();
                eventManager.call();
            },
            cancel() {
                activateOrganizationModal.deactivate();
            }
        });

        activateOrganizationModal.activate({ params });
    };

    /**
     * Change organization keys
     */
    $scope.changeOrganizationKeys = () => {
        const nonPrivate = $scope.members.filter((member) => member.Private === 0);
        const otherAdmins = $scope.members.filter((member) => member.Role === CONSTANTS.PAID_ADMIN_ROLE).length > 1;

        if (nonPrivate.length > 0 && $scope.keyStatus > 0) {
            notify({ message: gettextCatalog.getString('You must privatize all sub-accounts before generating new organization keys', null, 'Error'), classes: 'notification-danger' });
            return;
        }

        generateOrganizationModal.activate({
            params: {
                nonPrivate,
                existingKey: $scope.organizationKey,
                otherAdmins,
                submit(pkg) {

                    pmcw.keyInfo(pkg.toPublic().armor())
                    .then((obj) => {
                        $scope.organizationKeyInfo = obj;
                    });

                    $scope.keyStatus = 0;
                    $scope.organizationKey = pkg;

                    generateOrganizationModal.deactivate();
                    eventManager.call();
                },
                cancel() {
                    generateOrganizationModal.deactivate();
                }
            }
        });
    };

    addressesInit();
});
